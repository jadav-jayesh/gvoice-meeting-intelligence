import pino from "pino";
import { env } from "../config/env";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "req.headers.authorization",
      "config.azureOpenAI.apiKey",
      "config.storage.connectionString",
      "*.apiKey",
      "*.connectionString"
    ],
    remove: true
  }
});
