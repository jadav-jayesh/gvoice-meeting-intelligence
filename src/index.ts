import { createServer } from "./server";
import { connectMongo, disconnectMongo } from "./db/mongoose";
import { hydrateRuntimeConfig } from "./config/runtimeConfig";
import { env } from "./config/env";
import { logger } from "./utils/logger";
import { createBotWorker } from "./queue/workerFactory";
import { botQueue } from "./queue/botQueue";
import { startCalendarAutoJoinPoller, stopCalendarAutoJoinPoller } from "./services/calendar/calendarAutoJoinService";

async function main(): Promise<void> {
  await connectMongo();
  await hydrateRuntimeConfig();

  const app = createServer();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "gVoice meeting intelligence API listening");
  });

  const workerBundle = env.RUN_WORKER_IN_API ? createBotWorker() : undefined;
  // The poller schedules auto-joins onto the bot queue, so only run it where the
  // in-process worker runs; with a separate worker process, worker.ts owns it.
  if (workerBundle) startCalendarAutoJoinPoller();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    stopCalendarAutoJoinPoller();
    server.close();
    await workerBundle?.worker.close().catch((error) => logger.warn({ err: error }, "worker close failed"));
    await workerBundle?.events.close().catch((error) => logger.warn({ err: error }, "queue events close failed"));
    await botQueue.close().catch((error) => logger.warn({ err: error }, "queue close failed"));
    await disconnectMongo();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.fatal({ err: error }, "process failed to start");
  process.exit(1);
});
