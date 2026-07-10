import dotenv from "dotenv";

dotenv.config();

import { connectMongo, disconnectMongo } from "../src/db/mongoose";
import { BotSessionModel } from "../src/models/BotSession";
import { MomReportService } from "../src/ai/momReportService";
import { logger } from "../src/utils/logger";
import type { BotSession } from "../src/models/BotSession";

// Recompute the meeting duration the same way the orchestrator does: prefer the
// real start/end window, otherwise fall back to the last transcript timestamp.
function resolveDurationSeconds(session: Pick<BotSession, "startedAt" | "endedAt" | "diarizedTranscript">): number {
  if (session.startedAt && session.endedAt) {
    const start = new Date(session.startedAt).getTime();
    const end = new Date(session.endedAt).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return Math.round((end - start) / 1000);
    }
  }
  if (session.diarizedTranscript?.length) {
    return Math.max(0, ...session.diarizedTranscript.map((segment) => segment.endTime ?? 0));
  }
  return 0;
}

async function regenerate(sessionId: string, dryRun: boolean): Promise<void> {
  const session = await BotSessionModel.findOne({ sessionId }).lean();
  if (!session) {
    logger.warn({ sessionId }, "session not found; skipping");
    return;
  }

  if (!session.transcriptText?.trim() && !session.diarizedTranscript?.length) {
    logger.warn({ sessionId }, "session has no transcript; the report will use the fallback renderer");
  }

  const meetingTitle =
    session.meetingName?.trim() ||
    session.summary?.split(/[.!?]/)[0]?.trim() ||
    session.sessionId;

  const report = await new MomReportService(logger).generate({
    meetingTitle,
    summary: session.summary ?? "",
    participants: session.participants ?? [],
    transcript: session.diarizedTranscript ?? [],
    transcriptText: session.transcriptText ?? "",
    actionItems: session.actionItems ?? [],
    sentimentSummary: session.sentimentSummary,
    durationSeconds: resolveDurationSeconds(session),
    meetingDate: session.startedAt ? new Date(session.startedAt) : undefined
  });

  const summary = {
    sessionId,
    source: report.source,
    generationError: report.generationError,
    sections: report.momSections.length,
    actions: report.actionItems.length,
    risks: report.risks.length,
    todos: report.topTodos.length
  };

  if (dryRun) {
    logger.info(summary, "[dry-run] momReport generated (not saved)");
    return;
  }

  // Never overwrite an existing report with a degraded fallback (e.g. when the
  // AI call hit a transient 429/timeout) — that would silently destroy good
  // data. Only persist genuine AI output, or a first-time fallback.
  if (report.source !== "ai") {
    const existing = await BotSessionModel.findOne({ sessionId }, { "momReport.source": 1 }).lean();
    if (existing?.momReport) {
      logger.warn(summary, "generation did not produce an AI report; keeping existing report (not overwriting)");
      return;
    }
  }

  await BotSessionModel.updateOne({ sessionId }, { $set: { momReport: report } });
  logger.info(summary, "momReport regenerated and saved");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const sessionIds = args.filter((arg) => !arg.startsWith("-"));

  if (!sessionIds.length) {
    console.error("Usage: npm run mom:regenerate -- <sessionId> [<sessionId> ...] [--dry-run]");
    process.exit(1);
  }

  await connectMongo();
  try {
    for (const sessionId of sessionIds) {
      await regenerate(sessionId, dryRun);
    }
  } finally {
    await disconnectMongo();
  }
}

main().catch((error) => {
  logger.error({ err: error }, "regenerate-mom-report failed");
  process.exit(1);
});
