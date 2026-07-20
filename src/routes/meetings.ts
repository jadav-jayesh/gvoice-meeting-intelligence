import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { BotSessionModel } from "../models/BotSession";
import { UserModel } from "../models/User";
import { requireAuth } from "../middleware/requireAuth";
import { requireCsrf } from "../middleware/requireCsrf";
import { deleteMeetingForUser, deleteMeetingAsAdmin } from "../services/account/dataDeletion";
import { enableShare, disableShare } from "../services/meetingShare";
import { signBlobReadUrl } from "../storage/azureBlobStorage";
import { botPlatforms, botStatuses } from "../types/meeting";

// Re-sign the stored recording/thumbnail URLs with a fresh read SAS so the
// browser can fetch them (the storage account is private). Mutates a shallow
// copy of the lean document so the change isn't accidentally persisted.
function withSignedMediaUrls<T extends { recordingUrl?: string; thumbnailUrl?: string }>(doc: T): T {
  return {
    ...doc,
    ...(doc.recordingUrl ? { recordingUrl: signBlobReadUrl(doc.recordingUrl) } : {}),
    ...(doc.thumbnailUrl ? { thumbnailUrl: signBlobReadUrl(doc.thumbnailUrl) } : {})
  };
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  platform: z.enum(botPlatforms).optional(),
  status: z.enum(botStatuses).optional(),
  search: z.string().trim().min(1).max(200).optional()
});

// Fields returned in the list view — small enough to render hundreds of cards
// without pulling the full transcript / logs for each.
const listProjection = {
  sessionId: 1,
  platform: 1,
  meetingUrl: 1,
  meetingName: 1,
  status: 1,
  participants: 1,
  summary: 1,
  transcriptionProvider: 1,
  meetingLanguage: 1,
  actionItems: 1,
  recordingUrl: 1,
  thumbnailUrl: 1,
  startedAt: 1,
  endedAt: 1,
  createdAt: 1,
  updatedAt: 1,
  "sentimentSummary.overall": 1
} as const;

// Admins can view every meeting, not just their own or ones shared with them.
// The role is read from the DB per request (same rationale as requireAdmin): the
// access token lives for days, so reading role from the JWT would let a demoted
// admin keep global visibility until it expired. A per-request lookup makes
// promote/demote take effect immediately. Meetings endpoints are low enough
// volume that the extra indexed _id read is negligible.
async function isAdmin(userId: string): Promise<boolean> {
  const user = await UserModel.findById(userId).select("role").lean();
  return user?.role === "admin";
}

// The visibility clause for a session query: admins see all sessions (empty
// clause), everyone else is scoped to sessions they own or that were shared to
// them (accessUserIds holds both).
async function accessClause(userId: string): Promise<Record<string, unknown>> {
  return (await isAdmin(userId)) ? {} : { accessUserIds: userId };
}

export const meetingsRouter = Router();

meetingsRouter.use(requireAuth);

meetingsRouter.get("/", async (req, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query);
    // Visibility = owner OR shared viewer (accessUserIds holds both) — or ALL
    // sessions when the caller is an admin. Cosmos can still serve the sort
    // since the createdAt index covers both the scoped and the unscoped query.
    const filter: Record<string, unknown> = await accessClause(req.user!.id);
    if (query.platform) filter.platform = query.platform;
    if (query.status) filter.status = query.status;
    if (query.search) {
      const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(escaped, "i");
      filter.$or = [
        { sessionId: re },
        { meetingUrl: re },
        { meetingName: re },
        { summary: re },
        { transcriptText: re },
        { "participants.name": re }
      ];
    }

    const skip = (query.page - 1) * query.pageSize;
    const [items, total] = await Promise.all([
      BotSessionModel.find(filter, listProjection)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(query.pageSize)
        .lean(),
      BotSessionModel.countDocuments(filter)
    ]);

    res.json({
      items: items.map(withSignedMediaUrls),
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: skip + items.length < total
    });
  } catch (error) {
    next(error);
  }
});

// Aggregated stats across ALL the user's meetings (not just the current page).
// Mounted BEFORE /:sessionId so Express doesn't route "stats" into the param
// handler. Single $group aggregation — counts, sums, and shares computed in
// the database, so the response is one document regardless of corpus size.
meetingsRouter.get("/stats", async (req, res, next) => {
  try {
    const userId = new Types.ObjectId(req.user!.id);
    const [agg] = await BotSessionModel.aggregate([
      { $match: { accessUserIds: userId } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          recorded: {
            $sum: { $cond: [{ $ifNull: ["$recordingUrl", false] }, 1, 0] }
          },
          positive: {
            $sum: {
              $cond: [{ $eq: ["$sentimentSummary.overall.label", "positive"] }, 1, 0]
            }
          },
          withSentiment: {
            $sum: { $cond: [{ $ifNull: ["$sentimentSummary.overall", false] }, 1, 0] }
          },
          actionItems: {
            $sum: { $size: { $ifNull: ["$actionItems", []] } }
          }
        }
      }
    ]);

    const total = agg?.total ?? 0;
    const positive = agg?.positive ?? 0;
    const withSentiment = agg?.withSentiment ?? 0;
    const actionItems = agg?.actionItems ?? 0;

    res.json({
      total,
      recorded: agg?.recorded ?? 0,
      positive,
      positiveShare: withSentiment > 0 ? Math.round((positive / withSentiment) * 100) : null,
      actionItems,
      avgActions: total > 0 ? Number((actionItems / total).toFixed(1)) : null
    });
  } catch (error) {
    next(error);
  }
});

meetingsRouter.get("/:sessionId", async (req, res, next) => {
  try {
    // Detail view trims meetingLogs to just the LATEST entry — the full array
    // can grow to hundreds of entries per session, but the detail page needs
    // only the most recent one to caption live processing progress while it
    // polls an in-flight session. /meetings/:id/logs still serves the full set.
    //
    // NOTE: we slice in JS, NOT via a `{ meetingLogs: { $slice: -1 } }`
    // projection. Native MongoDB treats a $slice-only projection as "return the
    // whole doc, just slice this field", but Cosmos DB's Mongo API treats it as
    // an INCLUSION projection and returns only _id + meetingLogs — stripping
    // every other field, which blanks the detail page in production.
    const session = await BotSessionModel.findOne(
      { sessionId: req.params.sessionId, ...(await accessClause(req.user!.id)) }
    ).lean();
    if (!session) {
      res.status(404).json({ error: "Meeting not found" });
      return;
    }
    if (Array.isArray(session.meetingLogs)) {
      session.meetingLogs = session.meetingLogs.slice(-1);
    }
    res.json(withSignedMediaUrls(session));
  } catch (error) {
    next(error);
  }
});

// Stream the recording through our backend with Content-Disposition:
// attachment so the browser saves the file directly instead of opening it.
// Necessary because cross-origin URLs (Azure Blob) ignore the <a download>
// hint, leaving the user with a video that opens in a new tab.
meetingsRouter.get("/:sessionId/recording", async (req, res, next) => {
  try {
    const session = await BotSessionModel.findOne(
      { sessionId: req.params.sessionId, ...(await accessClause(req.user!.id)) },
      { recordingUrl: 1, meetingName: 1, sessionId: 1 }
    ).lean();
    if (!session) {
      res.status(404).json({ error: "Meeting not found" });
      return;
    }
    if (!session.recordingUrl) {
      res.status(404).json({ error: "Recording not available" });
      return;
    }

    const signedUrl = signBlobReadUrl(session.recordingUrl);
    if (!signedUrl) {
      res.status(404).json({ error: "Recording not available" });
      return;
    }

    // Forward the Range header so a download manager / video player that
    // wants byte-range chunks still works through the proxy.
    const upstreamHeaders: Record<string, string> = {};
    if (req.headers.range) upstreamHeaders.range = String(req.headers.range);

    const upstream = await fetch(signedUrl, { headers: upstreamHeaders });
    if (!upstream.ok || !upstream.body) {
      res.status(502).json({ error: "Failed to fetch recording" });
      return;
    }

    const safe =
      (session.meetingName || session.sessionId)
        .replace(/[^\w\-\s.]+/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .slice(0, 60) || "recording";

    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "video/mp4");
    const len = upstream.headers.get("content-length");
    if (len) res.setHeader("Content-Length", len);
    const range = upstream.headers.get("content-range");
    if (range) res.setHeader("Content-Range", range);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}.mp4"`);
    res.setHeader("Cache-Control", "private, no-store");

    const { Readable } = await import("node:stream");
    const { pipeline } = await import("node:stream/promises");
    // Cast: Node's fromWeb expects its own ReadableStream type; the global
    // one from undici is compatible at runtime.
    await pipeline(Readable.fromWeb(upstream.body as never), res);
  } catch (error) {
    next(error);
  }
});

meetingsRouter.get("/:sessionId/logs", async (req, res, next) => {
  try {
    const session = await BotSessionModel.findOne(
      { sessionId: req.params.sessionId, ...(await accessClause(req.user!.id)) },
      { meetingLogs: 1 }
    ).lean();
    if (!session) {
      res.status(404).json({ error: "Meeting not found" });
      return;
    }
    res.json({ logs: session.meetingLogs ?? [] });
  } catch (error) {
    next(error);
  }
});

// Create (or re-enable) a public share link for a meeting. Anyone with access
// to the meeting (owner/shared viewer) or an admin can share it. Returns the
// public URL + token so the UI can copy it.
meetingsRouter.post("/:sessionId/share", requireCsrf, async (req, res, next) => {
  try {
    const result = await enableShare(String(req.params.sessionId), req.user!.id, await isAdmin(req.user!.id));
    if (result.status === "not_found") {
      res.status(404).json({ error: "Meeting not found" });
      return;
    }
    if (result.status === "forbidden") {
      res.status(403).json({ error: "You can't share this meeting" });
      return;
    }
    res.json({ enabled: result.enabled, token: result.token, url: result.url });
  } catch (error) {
    next(error);
  }
});

// Revoke a meeting's public share link. The same link stops working instantly.
meetingsRouter.delete("/:sessionId/share", requireCsrf, async (req, res, next) => {
  try {
    const result = await disableShare(String(req.params.sessionId), req.user!.id, await isAdmin(req.user!.id));
    if (result.status === "not_found") {
      res.status(404).json({ error: "Meeting not found" });
      return;
    }
    if (result.status === "forbidden") {
      res.status(403).json({ error: "You can't share this meeting" });
      return;
    }
    res.json({ enabled: false });
  } catch (error) {
    next(error);
  }
});

// Delete a meeting for the current user. If other users still have access
// (shared meeting) only this user is detached; once nobody can see it, the
// recording and document are permanently removed.
meetingsRouter.delete("/:sessionId", requireCsrf, async (req, res, next) => {
  try {
    // Admins can delete any meeting (full purge); everyone else only their own.
    const sessionId = String(req.params.sessionId);
    const result = (await isAdmin(req.user!.id))
      ? await deleteMeetingAsAdmin(sessionId)
      : await deleteMeetingForUser(sessionId, req.user!.id);
    if (result === "not_found") {
      res.status(404).json({ error: "Meeting not found" });
      return;
    }
    res.json({ ok: true, purged: result === "purged" });
  } catch (error) {
    next(error);
  }
});
