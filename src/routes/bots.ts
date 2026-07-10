import { Router } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { BotSessionModel } from "../models/BotSession";
import { enqueueBotSession } from "../queue/botQueue";
import { requireAuth } from "../middleware/requireAuth";
import { requireCsrf } from "../middleware/requireCsrf";
import { appendMeetingLog } from "../services/meetingLogService";
import { meetingDedupeKey } from "../utils/meetingUrl";
import { botPlatforms } from "../types/meeting";

// A session is "live in the call" while in one of these states; once it reaches
// uploading/processing/terminal the bot has already left, so a manual joiner
// then is a genuinely new meeting (don't attach).
const LIVE_STATUSES = ["queued", "starting", "joining", "recording"] as const;
// Safety net for a session with no known scheduled end (manual-created bots):
// only treat it as the same live meeting if it's recent. Comfortably longer
// than any real single meeting, shorter than a daily/weekly recurring-link
// reuse, so yesterday's zombie bot can't absorb today's meeting.
const MANUAL_LIVE_WINDOW_MS = 6 * 60 * 60 * 1000;
// Grace past a calendar bot's scheduled end before we stop attaching to it.
const SCHEDULED_END_GRACE_MS = 15 * 60 * 1000;

/**
 * Pure "is this candidate bot still in the call?" check (status already filtered
 * to LIVE_STATUSES by the query). Uses the scheduled end + grace when known
 * (calendar bots — precise), else a recency net (manual bots — no end known).
 */
export function isBotStillLive(opts: {
  now: number;
  scheduledEndAtMs?: number;
  createdAtMs: number;
}): boolean {
  const { now, scheduledEndAtMs, createdAtMs } = opts;
  if (scheduledEndAtMs !== undefined && Number.isFinite(scheduledEndAtMs)) {
    return now < scheduledEndAtMs + SCHEDULED_END_GRACE_MS;
  }
  return now - createdAtMs < MANUAL_LIVE_WINDOW_MS;
}

/**
 * Find a bot already live for this join link, so a manual "Join Meeting" attaches
 * to it instead of spawning a duplicate.
 */
async function findLiveBotForLink(meetingUrl: string): Promise<{ sessionId: string; status: string } | null> {
  const dedupeKey = meetingDedupeKey(meetingUrl);
  const candidates = await BotSessionModel.find({
    meetingDedupeKey: dedupeKey,
    status: { $in: LIVE_STATUSES }
  })
    .select("sessionId status scheduledEndAt createdAt")
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  const now = Date.now();
  for (const c of candidates) {
    if (
      isBotStillLive({
        now,
        scheduledEndAtMs: c.scheduledEndAt ? new Date(c.scheduledEndAt).getTime() : undefined,
        createdAtMs: new Date((c as unknown as { createdAt: Date }).createdAt).getTime()
      })
    ) {
      return { sessionId: c.sessionId, status: c.status };
    }
  }
  return null;
}

const createBotSchema = z.object({
  platform: z.enum(botPlatforms),
  meetingUrl: z.string().url(),
  meetingPasscode: z.string().min(1).max(128).optional(),
  webhookUrl: z.string().url().optional()
});

export const botsRouter = Router();

botsRouter.use(requireAuth);
botsRouter.use(requireCsrf);

botsRouter.post("/", async (req, res, next) => {
  try {
    const payload = createBotSchema.parse(req.body);

    // One bot per live meeting: if a bot is already in this call (calendar
    // auto-join or another manual join), attach to it instead of launching a
    // duplicate. (Phase 1: the meeting stays owned by the first joiner;
    // shared visibility for the others is Phase 2.)
    const liveBot = await findLiveBotForLink(payload.meetingUrl);
    if (liveBot) {
      // Shared visibility: the manual joiner gets view access to the already-live
      // meeting (no second bot). Owner stays whoever created it.
      await BotSessionModel.updateOne(
        { sessionId: liveBot.sessionId },
        { $addToSet: { accessUserIds: req.user!.id } }
      );
      res.status(202).json({ sessionId: liveBot.sessionId, status: liveBot.status, attached: true });
      return;
    }

    const sessionId = uuidv4();
    const session = await BotSessionModel.create({
      sessionId,
      userId: req.user!.id,
      accessUserIds: [req.user!.id],
      platform: payload.platform,
      meetingUrl: payload.meetingUrl,
      meetingDedupeKey: meetingDedupeKey(payload.meetingUrl),
      meetingPasscode: payload.meetingPasscode,
      webhookUrl: payload.webhookUrl,
      status: "queued",
      meetingLogs: [
        {
          time: new Date(),
          level: "info",
          phase: "session",
          event: "session_created",
          message: "Meeting bot session created",
          status: "queued",
          metadata: {
            platform: payload.platform,
            hasWebhookUrl: Boolean(payload.webhookUrl)
          }
        }
      ]
    });

    await enqueueBotSession(sessionId);
    await appendMeetingLog(sessionId, {
      phase: "queue",
      event: "job_enqueued",
      message: "Meeting bot job enqueued",
      status: "queued"
    });

    res.status(202).json({
      sessionId: session.sessionId,
      status: session.status
    });
  } catch (error) {
    next(error);
  }
});

botsRouter.get("/:sessionId", async (req, res, next) => {
  try {
    const session = await BotSessionModel.findOne({
      sessionId: req.params.sessionId,
      accessUserIds: req.user!.id
    }).lean();
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(session);
  } catch (error) {
    next(error);
  }
});
