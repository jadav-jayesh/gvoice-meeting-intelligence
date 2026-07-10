import { Worker, QueueEvents } from "bullmq";
import { env, redisConnection } from "../config/env";
import { MeetingOrchestrator } from "../services/meetingOrchestrator";
import { runCalendarJoin } from "../services/calendar/calendarAutoJoinService";
import { logger } from "../utils/logger";
import type { BotJobPayload } from "../types/meeting";

export function createBotWorker(): { worker: Worker<BotJobPayload>; events: QueueEvents } {
  const orchestrator = new MeetingOrchestrator();
  const worker = new Worker<BotJobPayload>(
    env.BOT_QUEUE_NAME,
    async (job) => {
      logger.info({ jobId: job.id, sessionId: job.data.sessionId, kind: job.data.kind }, "bot job started");
      if (job.data.kind === "calendar_join") {
        if (job.data.calendar) await runCalendarJoin(job.data.calendar);
      } else if (job.data.kind === "poll_teams_transcript") {
        if (job.data.sessionId) await orchestrator.pollMicrosoftTeamsTranscript(job.data.sessionId, job.data.retryCount ?? 0);
      } else if (job.data.sessionId) {
        await orchestrator.run(job.data.sessionId);
      }
      logger.info({ jobId: job.id, sessionId: job.data.sessionId, kind: job.data.kind }, "bot job completed");
    },
    {
      connection: redisConnection,
      concurrency: env.BOT_WORKER_CONCURRENCY
    }
  );

  const events = new QueueEvents(env.BOT_QUEUE_NAME, { connection: redisConnection });

  worker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, sessionId: job?.data.sessionId, err: error }, "bot job failed");
  });
  worker.on("error", (error) => logger.error({ err: error }, "bot worker error"));
  events.on("waiting", ({ jobId }) => logger.info({ jobId }, "bot job waiting"));

  return { worker, events };
}
