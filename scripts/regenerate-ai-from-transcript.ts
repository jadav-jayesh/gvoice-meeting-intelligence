import dotenv from "dotenv";
dotenv.config();

import { connectMongo, disconnectMongo } from "../src/db/mongoose";
import { BotSessionModel } from "../src/models/BotSession";
import { SummaryService } from "../src/ai/summaryService";
import { MomReportService } from "../src/ai/momReportService";
import { logger } from "../src/utils/logger";
import type { DiarizedTranscriptSegment } from "../src/types/meeting";

// Re-run ONLY the AI layer (summary + MoM) against a session's CURRENT stored
// transcript — no re-transcription. Use after correcting speaker labels (e.g.
// via remap-speakers-from-teams) so the summary/action-items/MoM reflect the
// fixed names instead of stale ones.
//
//   npx tsx scripts/regenerate-ai-from-transcript.ts <sessionId>
async function main(): Promise<void> {
  const sessionId = process.argv[2];
  if (!sessionId) { console.error("usage: tsx scripts/regenerate-ai-from-transcript.ts <sessionId>"); process.exit(1); }

  await connectMongo();
  try {
    const session = await BotSessionModel.findOne({ sessionId });
    if (!session) { console.error(`session ${sessionId} not found`); return; }

    const participants = session.participants ?? [];
    let transcript = (session.diarizedTranscript ?? []).map((seg) =>
      (typeof (seg as { toObject?: () => DiarizedTranscriptSegment }).toObject === "function"
        ? (seg as { toObject: () => DiarizedTranscriptSegment }).toObject()
        : seg) as DiarizedTranscriptSegment
    );
    const transcriptText = session.transcriptText ?? "";
    if (!transcriptText.trim()) { console.error("session has no transcript text"); return; }

    const summary = await new SummaryService(logger).summarize({ participants, transcript, transcriptText });
    transcript = summary.transcriptWithSentiment;

    const meetingName = summary.shortTitle?.trim() || session.meetingName;
    const startedAt = session.startedAt ? new Date(session.startedAt) : new Date();
    const durationSeconds = session.startedAt && session.endedAt
      ? Math.max(0, (new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000)
      : 0;

    const momReport = await new MomReportService(logger).generate({
      meetingTitle: meetingName?.trim() || sessionId,
      summary: summary.summary,
      participants,
      transcript,
      transcriptText,
      actionItems: summary.actionItems,
      sentimentSummary: summary.sentimentSummary,
      durationSeconds,
      meetingDate: startedAt
    });

    await BotSessionModel.updateOne({ sessionId }, { $set: {
      diarizedTranscript: transcript,
      summary: summary.summary,
      meetingName,
      chapters: summary.chapters,
      actionItems: summary.actionItems,
      sentimentSummary: summary.sentimentSummary,
      momReport
    } });

    console.log("summary source:", summary.source);
    console.log("action item assignees:", JSON.stringify(summary.actionItems.map((a) => a.assignee)));
    console.log("mom action owners:", JSON.stringify((momReport.actionItems ?? []).flatMap((a) => a.owners ?? [])));
    console.log("saved.");
  } finally {
    await disconnectMongo();
  }
}

main().catch((e) => { console.error("ERR:", e instanceof Error ? e.message : e); process.exit(1); });
