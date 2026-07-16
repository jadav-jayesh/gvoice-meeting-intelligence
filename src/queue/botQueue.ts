import { Queue } from "bullmq";
import { env, redisConnection } from "../config/env";
import type { BotJobPayload, CalendarJoinPayload } from "../types/meeting";

export const botQueue = new Queue<BotJobPayload>(env.BOT_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 }
  }
});

export async function enqueueBotSession(sessionId: string): Promise<void> {
  await botQueue.add(
    "run-bot",
    { sessionId, kind: "run_bot" },
    {
      jobId: sessionId,
      // Retry once on a JOIN failure (e.g. Teams' web app failing to load). The
      // orchestrator only re-throws for PRE-recording failures, so a meeting that
      // already started recording is never re-joined / double-recorded. Per-job
      // (not defaultJobOptions) so calendar-join / transcript-poll are unaffected.
      attempts: 2,
      backoff: { type: "fixed", delay: 20000 }
    }
  );
}

// Schedules an auto-join for a calendar event. The jobId is keyed on the
// event instance so repeated polls before the join fires don't double-schedule
// (BullMQ rejects a duplicate jobId while the delayed job is still pending).
// BullMQ also forbids ':' in a custom jobId (it's the Redis key separator), and
// the event key embeds an ISO timestamp, so strip colons.
export async function enqueueCalendarJoin(calendar: CalendarJoinPayload, delayMs: number): Promise<void> {
  await botQueue.add(
    "calendar-join",
    { kind: "calendar_join", calendar },
    { jobId: safeJobId(`caljoin:${calendar.meetingInstanceKey}`), delay: Math.max(0, delayMs) }
  );
}

// BullMQ rejects a custom jobId containing ':' — replace with '-'.
function safeJobId(raw: string): string {
  return raw.replace(/:/g, "-");
}

export async function enqueueTeamsTranscriptRetry(sessionId: string, retryCount: number, delayMs: number): Promise<void> {
  await botQueue.add(
    "poll-teams-transcript",
    { sessionId, kind: "poll_teams_transcript", retryCount },
    {
      jobId: safeJobId(`${sessionId}:teams-transcript:${retryCount}`),
      delay: delayMs
    }
  );
}
