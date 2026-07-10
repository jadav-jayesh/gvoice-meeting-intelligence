import { connectMongo, disconnectMongo } from "./db/mongoose";
import { createBotWorker } from "./queue/workerFactory";
import { startCalendarAutoJoinPoller, stopCalendarAutoJoinPoller } from "./services/calendar/calendarAutoJoinService";
import { hydrateRuntimeConfig } from "./config/runtimeConfig";
import { logger } from "./utils/logger";

async function main(): Promise<void> {
  await connectMongo();
  await hydrateRuntimeConfig();
  const { worker, events } = createBotWorker();
  startCalendarAutoJoinPoller();
  logger.info("gVoice meeting bot worker listening");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker shutting down");
    stopCalendarAutoJoinPoller();
    await worker.close();
    await events.close();
    await disconnectMongo();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.fatal({ err: error }, "worker failed to start");
  process.exit(1);
});
