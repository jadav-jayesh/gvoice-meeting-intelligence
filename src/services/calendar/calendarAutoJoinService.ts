import { v4 as uuidv4 } from "uuid";
import { env } from "../../config/env";
import { BotSessionModel } from "../../models/BotSession";
import { CalendarConnectionModel } from "../../models/CalendarConnection";
import { enqueueBotSession, enqueueCalendarJoin } from "../../queue/botQueue";
import { appendMeetingLog } from "../meetingLogService";
import { meetingDedupeKey } from "../../utils/meetingUrl";
import { logger as rootLogger } from "../../utils/logger";
import type { CalendarJoinPayload } from "../../types/meeting";
import { getUpcomingMeetings } from "./calendarEventsService";

// Calendar-driven auto-join. A poller periodically reads each connected user's
// upcoming meetings (calendarEventsService), and for any with a recognized
// meeting link that's about to start it schedules a DELAYED BullMQ job. When
// that job fires (CALENDAR_JOIN_LEAD_SECONDS before the meeting), it creates a
// BotSession and enqueues the very same run-bot job the manual "Join meeting"
// flow uses — so the bot joins exactly as if a user had pasted the link.
//
// Idempotency comes from two layers: the delayed job's deterministic jobId
// (dedup while pending) and BotSession.meetingInstanceKey (unique index, dedup
// after the session is created / across retries, multiple pollers AND multiple
// invited users — the key has no userId so all invitees collapse to one bot).

const logger = rootLogger.child({ module: "calendar-auto-join" });

const STARTED_GRACE_MS = 120_000; // still join up to 2 min after the lead point

// Only commit joins whose join-time is within the next poll cycle (+buffer).
// Anything further out is re-evaluated on a later poll, so reschedules and
// cancellations are picked up rather than locked in far ahead of time.
function scheduleHorizonMs(): number {
  return env.CALENDAR_SYNC_INTERVAL_MS + 90_000;
}

/**
 * Cross-user per-instance dedup key for a calendar meeting occurrence. Contains
 * NO userId, so every user invited to the same meeting (same link, same start)
 * produces the SAME key — the second poll finds the first user's bot and skips,
 * collapsing N invitees to one bot.
 */
export function instanceKey(joinUrl: string, startMs: number): string {
  return `${meetingDedupeKey(joinUrl)}#${new Date(startMs).toISOString()}`;
}

/**
 * Decide whether to commit an auto-join for a meeting on the current poll, and
 * after how long. A join fires when EITHER:
 *  - upcoming: the join-time (start - lead) falls within the next poll cycle
 *    (+lead buffer) and isn't already long past. Far-future meetings wait for a
 *    later poll so reschedules/cancellations aren't locked in early.
 *  - in progress: the meeting is happening right now and hasn't ended — catches
 *    instant "meet now" meetings and any the pre-start window was missed for (a
 *    restart, a meeting created seconds before start, a slow first sync). The
 *    bot joins a little late instead of not at all (delay clamped to 0).
 */
export function evaluateJoin(opts: {
  startMs: number;
  endMs: number;
  now: number;
  leadMs: number;
  horizonMs: number;
  graceMs: number;
}): { schedule: boolean; delayMs: number } {
  const { startMs, endMs, now, leadMs, horizonMs, graceMs } = opts;
  if (!Number.isFinite(startMs)) return { schedule: false, delayMs: 0 };

  const joinAtMs = startMs - leadMs;
  const delay = joinAtMs - now;

  const ongoing = now >= startMs && Number.isFinite(endMs) && now < endMs;
  const upcoming = delay <= horizonMs && joinAtMs >= now - graceMs;
  if (!ongoing && !upcoming) return { schedule: false, delayMs: 0 };

  return { schedule: true, delayMs: Math.max(0, delay) };
}

/** Poll every connected user and schedule imminent auto-joins. */
export async function syncAndScheduleAll(): Promise<void> {
  if (!env.CALENDAR_AUTO_JOIN_ENABLED) return;
  const userIds = await CalendarConnectionModel.distinct("userId", { status: { $ne: "revoked" } });
  for (const userId of userIds) {
    try {
      await scheduleForUser(String(userId));
    } catch (error) {
      logger.warn({ err: error, userId: String(userId) }, "calendar auto-join scheduling failed for user");
    }
  }
}

async function scheduleForUser(userId: string): Promise<void> {
  const leadMs = env.CALENDAR_JOIN_LEAD_SECONDS * 1000;
  const now = Date.now();
  const horizon = scheduleHorizonMs();

  const { meetings } = await getUpcomingMeetings(userId, {
    from: new Date(now),
    to: new Date(now + env.CALENDAR_LOOKAHEAD_HOURS * 3600 * 1000)
  });

  for (const meeting of meetings) {
    if (!meeting.autoJoin || !meeting.joinUrl || !meeting.platform) continue;

    const startMs = new Date(meeting.startTime).getTime();
    const endMs = new Date(meeting.endTime).getTime();

    const { schedule, delayMs } = evaluateJoin({
      startMs,
      endMs,
      now,
      leadMs,
      horizonMs: horizon,
      graceMs: STARTED_GRACE_MS
    });
    if (!schedule) continue;

    const key = instanceKey(meeting.joinUrl, startMs);

    // Already turned into a session by ANY invited user (this poll or a previous
    // one, this user or another)? Don't make a second bot — but DO grant this
    // invited user view access to the shared meeting (Phase 2), then skip.
    const existing = await BotSessionModel.findOne({ meetingInstanceKey: key }).select("userId").lean();
    if (existing) {
      if (String(existing.userId) !== userId) {
        await BotSessionModel.updateOne(
          { meetingInstanceKey: key },
          { $addToSet: { accessUserIds: userId } }
        );
      }
      continue;
    }

    const payload: CalendarJoinPayload = {
      userId,
      platform: meeting.platform,
      meetingUrl: meeting.joinUrl,
      title: meeting.title,
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      meetingInstanceKey: key,
      meetingDedupeKey: meetingDedupeKey(meeting.joinUrl)
    };

    await enqueueCalendarJoin(payload, delayMs);
    logger.info(
      { userId, platform: meeting.platform, title: meeting.title, joinInMs: delayMs, key },
      "calendar auto-join scheduled"
    );
  }
}

/**
 * Fires when a scheduled join's delay elapses: create the bot session and queue
 * the run-bot job (identical to the manual flow). Idempotent via the unique
 * meetingInstanceKey index.
 */
export async function runCalendarJoin(payload: CalendarJoinPayload): Promise<void> {
  if (!env.CALENDAR_AUTO_JOIN_ENABLED) return;

  const existing = await BotSessionModel.findOne({ meetingInstanceKey: payload.meetingInstanceKey })
    .select("sessionId")
    .lean();
  if (existing) {
    logger.info({ key: payload.meetingInstanceKey, sessionId: existing.sessionId }, "calendar auto-join already created");
    return;
  }

  const sessionId = uuidv4();
  try {
    await BotSessionModel.create({
      sessionId,
      userId: payload.userId,
      accessUserIds: [payload.userId],
      platform: payload.platform,
      meetingUrl: payload.meetingUrl,
      meetingPasscode: payload.meetingPasscode,
      meetingName: payload.title,
      // Keep the calendar title as the authoritative name so later page-title
      // scrapes / AI titles don't clobber it (see meetingOrchestrator).
      scheduledMeetingTitle: payload.title,
      source: "calendar",
      meetingInstanceKey: payload.meetingInstanceKey,
      meetingDedupeKey: payload.meetingDedupeKey,
      scheduledEndAt: payload.endTime ? new Date(payload.endTime) : undefined,
      status: "queued",
      meetingLogs: [
        {
          time: new Date(),
          level: "info",
          phase: "session",
          event: "session_created",
          message: "Auto-join session created from calendar",
          status: "queued",
          metadata: {
            platform: payload.platform,
            source: "calendar",
            title: payload.title,
            startTime: payload.startTime
          }
        }
      ]
    });
  } catch (error) {
    // Unique-index race (overlapping pollers / a retried job): another worker
    // already created the session — treat as success and stop.
    if ((error as { code?: number }).code === 11000) {
      logger.info({ key: payload.meetingInstanceKey }, "calendar auto-join already created (race), skipping");
      return;
    }
    throw error;
  }

  await enqueueBotSession(sessionId);
  await appendMeetingLog(sessionId, {
    phase: "queue",
    event: "job_enqueued",
    message: "Auto-join bot job enqueued",
    status: "queued"
  });
  logger.info({ sessionId, key: payload.meetingInstanceKey, platform: payload.platform }, "calendar auto-join started");
}

// ── Poller lifecycle ──────────────────────────────────────────────────────────

let pollerTimer: ReturnType<typeof setInterval> | undefined;

export function startCalendarAutoJoinPoller(): void {
  if (!env.CALENDAR_AUTO_JOIN_ENABLED) {
    logger.info("calendar auto-join disabled (set CALENDAR_AUTO_JOIN_ENABLED=true to enable)");
    return;
  }
  if (pollerTimer) return;
  logger.info(
    { intervalMs: env.CALENDAR_SYNC_INTERVAL_MS, leadSeconds: env.CALENDAR_JOIN_LEAD_SECONDS, lookaheadHours: env.CALENDAR_LOOKAHEAD_HOURS },
    "calendar auto-join poller started"
  );
  const tick = () => {
    void syncAndScheduleAll().catch((error) => logger.warn({ err: error }, "calendar auto-join poll failed"));
  };
  setTimeout(tick, 5_000); // first sweep shortly after boot
  pollerTimer = setInterval(tick, env.CALENDAR_SYNC_INTERVAL_MS);
  if (typeof pollerTimer.unref === "function") pollerTimer.unref();
}

export function stopCalendarAutoJoinPoller(): void {
  if (pollerTimer) {
    clearInterval(pollerTimer);
    pollerTimer = undefined;
  }
}
