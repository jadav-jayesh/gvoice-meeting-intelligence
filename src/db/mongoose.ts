import mongoose from "mongoose";
import { env } from "../config/env";
import { logger } from "../utils/logger";

export async function connectMongo(): Promise<typeof mongoose> {
  mongoose.set("strictQuery", true);
  mongoose.connection.on("disconnected", () => logger.warn("mongodb disconnected"));
  mongoose.connection.on("reconnected", () => logger.info("mongodb reconnected"));

  await mongoose.connect(env.MONGODB_URI, {
    autoIndex: env.NODE_ENV !== "production"
  });

  logger.info({ db: mongoose.connection.name }, "mongodb connected");
  return mongoose;
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}
