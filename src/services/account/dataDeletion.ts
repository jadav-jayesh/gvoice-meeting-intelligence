import { Types } from "mongoose";
import { BotSessionModel } from "../../models/BotSession";
import { CalendarConnectionModel } from "../../models/CalendarConnection";
import { RefreshTokenModel } from "../../models/RefreshToken";
import { UserModel } from "../../models/User";
import { AzureBlobStorage } from "../../storage/azureBlobStorage";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";

/**
 * User-initiated data deletion (right to erasure — DPDP 2023 / GDPR / CCPA).
 *
 * Honours the shared-meeting model: a single bot session can be visible to
 * several users (accessUserIds). Deleting a meeting therefore removes the
 * requesting user's access; the underlying recording and document are
 * hard-deleted (and the blobs purged) only once NO user can see it anymore.
 *
 * Read-only over the bot/processing pipeline — this never touches a live bot,
 * only persisted records and stored artifacts.
 */

export type MeetingDeletionResult = "purged" | "removed" | "not_found";

// Best-effort blob purge. Storage may be unconfigured in some environments, and
// a storage hiccup must not block the database deletion the user asked for.
async function purgeMeetingBlobs(sessionId: string): Promise<void> {
  if (!env.AZURE_STORAGE_CONNECTION_STRING) return;
  try {
    const storage = new AzureBlobStorage();
    const n = await storage.deleteMeetingArtifacts(sessionId);
    logger.info({ sessionId, blobs: n }, "purged meeting blobs on delete");
  } catch (err) {
    logger.warn({ sessionId, err }, "failed to purge meeting blobs (continuing)");
  }
}

/**
 * Delete one meeting for one user.
 * - "not_found": the user has no access to that session.
 * - "purged":    the user was the last viewer → document + blobs deleted.
 * - "removed":   other users still have access → only this user detached.
 */
export async function deleteMeetingForUser(sessionId: string, userId: string): Promise<MeetingDeletionResult> {
  const uid = new Types.ObjectId(userId);
  const session = await BotSessionModel.findOne({ sessionId, accessUserIds: uid })
    .select("sessionId accessUserIds")
    .lean();
  if (!session) return "not_found";

  const remaining = (session.accessUserIds ?? []).filter((id) => id.toString() !== userId);
  if (remaining.length === 0) {
    await BotSessionModel.deleteOne({ _id: session._id });
    await purgeMeetingBlobs(sessionId);
    return "purged";
  }

  await BotSessionModel.updateOne({ _id: session._id }, { $pull: { accessUserIds: uid } });
  return "removed";
}

/**
 * Admin deletion: permanently purge a meeting by sessionId regardless of who
 * owns it (admins manage every meeting, not just their own — mirrors the admin
 * read bypass on the meetings routes). Always a full hard-delete of the document
 * + blobs, since an admin removing a meeting means removing it outright.
 */
export async function deleteMeetingAsAdmin(sessionId: string): Promise<MeetingDeletionResult> {
  const session = await BotSessionModel.findOne({ sessionId }).select("sessionId").lean();
  if (!session) return "not_found";
  await BotSessionModel.deleteOne({ _id: session._id });
  await purgeMeetingBlobs(sessionId);
  return "purged";
}

/**
 * Permanently delete a user account and all associated personal data:
 * sole-owned meetings (+ their blobs), access to shared meetings, calendar
 * connections, refresh tokens and the user record itself.
 */
export async function deleteAccountData(userId: string): Promise<{ meetingsPurged: number; meetingsDetached: number }> {
  const uid = new Types.ObjectId(userId);

  // Match both the shared-visibility array and the legacy `userId` owner field:
  // sessions created before the accessUserIds backfill may have an empty
  // accessUserIds, and we must still purge data the user owns.
  const sessions = await BotSessionModel.find({ $or: [{ accessUserIds: uid }, { userId: uid }] })
    .select("sessionId accessUserIds")
    .lean();

  const soleOwned: string[] = []; // sessionIds — only this user can see them
  const sharedIds: Types.ObjectId[] = []; // _ids — other users still have access

  for (const s of sessions) {
    const others = (s.accessUserIds ?? []).filter((id) => id.toString() !== userId);
    if (others.length === 0) soleOwned.push(s.sessionId);
    else sharedIds.push(s._id as Types.ObjectId);
  }

  if (soleOwned.length) {
    await BotSessionModel.deleteMany({ sessionId: { $in: soleOwned } });
  }
  if (sharedIds.length) {
    await BotSessionModel.updateMany({ _id: { $in: sharedIds } }, { $pull: { accessUserIds: uid } });
  }

  // Purge blobs for the meetings we hard-deleted (best-effort, sequential to
  // avoid hammering storage on large accounts).
  for (const sessionId of soleOwned) {
    await purgeMeetingBlobs(sessionId);
  }

  await CalendarConnectionModel.deleteMany({ userId: uid });
  await RefreshTokenModel.deleteMany({ userId: uid });
  await UserModel.deleteOne({ _id: uid });

  logger.info(
    { userId, meetingsPurged: soleOwned.length, meetingsDetached: sharedIds.length },
    "account data deleted"
  );

  return { meetingsPurged: soleOwned.length, meetingsDetached: sharedIds.length };
}
