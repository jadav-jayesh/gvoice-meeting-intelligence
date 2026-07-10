import dotenv from "dotenv";

dotenv.config();

import { existsSync } from "node:fs";
import path from "node:path";
import { connectMongo, disconnectMongo } from "../src/db/mongoose";
import { env } from "../src/config/env";
import { BotSessionModel } from "../src/models/BotSession";
import { TranscriptionService, shouldTranslateToEnglish } from "../src/transcription/transcriptionService";
import { TranslationService } from "../src/ai/translationService";
import { normalizeDiarizedTranscript } from "../src/processing/diarization";
import { assessWhisperReliability } from "../src/processing/transcriptQuality";
import { buildCaptionDerivedTranscript } from "../src/processing/captionTranscript";
import { hasSpeechCaptionEvidence } from "../src/processing/captions";
import { analyzeSpeech } from "../src/media/ffmpeg";
import { mapSpeakersToParticipants } from "../src/processing/speakerMapper";
import { SpeakerResolverService } from "../src/ai/speakerResolverService";
import { buildTranscriptText } from "../src/processing/transcriptText";
import { SummaryService } from "../src/ai/summaryService";
import { MomReportService } from "../src/ai/momReportService";
import { logger } from "../src/utils/logger";
import type { DiarizedTranscriptSegment } from "../src/types/meeting";

// Re-runs the post-meeting intelligence pipeline against a finished session's
// already-recorded audio (.data/sessions/<id>/speech.wav), using the CURRENT
// src/ code. This is the fast way to validate a transcription/speaker-mapping
// change without scheduling a live meeting.
//
//   npm run session:reprocess -- <sessionId> [--dry-run] [--transcript-only]
//
//   --dry-run         compute everything, print the result, persist NOTHING.
//   --transcript-only skip the AI summary + MoM (faster; transcript + speakers
//                     only). Leaves the existing summary/MoM in place.

function speakerCounts(segments: Array<{ speaker: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const segment of segments) counts[segment.speaker] = (counts[segment.speaker] ?? 0) + 1;
  return counts;
}

async function reprocess(sessionId: string, options: { dryRun: boolean; transcriptOnly: boolean }): Promise<void> {
  const session = await BotSessionModel.findOne({ sessionId });
  if (!session) {
    logger.warn({ sessionId }, "session not found; skipping");
    return;
  }

  const audioPath = path.resolve(env.RECORDING_DIR, sessionId, "speech.wav");
  if (!existsSync(audioPath)) {
    logger.error({ sessionId, audioPath }, "speech.wav not found for session; cannot reprocess transcription");
    return;
  }

  const startedAt = session.startedAt ? new Date(session.startedAt) : undefined;
  const participants = session.participants ?? [];
  const captions = session.captionsTimeline ?? [];

  logger.info(
    { sessionId, audioPath, participants: participants.map((p) => p.name), beforeSpeakers: speakerCounts(session.diarizedTranscript ?? []) },
    "reprocess: starting (BEFORE state)"
  );

  // 1. Transcribe (provider + fallback per .env) ────────────────────────────
  const transcription = await new TranscriptionService(logger).transcribe(audioPath);
  logger.info(
    { provider: transcription.provider, language: transcription.language, segmentCount: transcription.segments.length },
    "reprocess: transcription complete"
  );

  // 2. Normalize → map speakers → resolve (same order as the orchestrator) ───
  const normalized = normalizeDiarizedTranscript(transcription.segments);
  let diarizedTranscript = mapSpeakersToParticipants(
    normalized,
    participants,
    captions,
    logger,
    startedAt,
    session.participantsTimeline ?? []
  );
  diarizedTranscript = await new SpeakerResolverService(logger).resolve({
    participants,
    diarizedTranscript: normalized,
    captionsTimeline: captions,
    currentTranscript: diarizedTranscript,
    meetingStartedAt: startedAt
  });
  let transcriptText = buildTranscriptText(diarizedTranscript);

  // 3. Translation (whisper provider + non-English only) ─────────────────────
  if (diarizedTranscript.length > 0 && shouldTranslateToEnglish(transcription)) {
    diarizedTranscript = await new TranslationService(logger).translateSegments(diarizedTranscript, {
      sourceLanguage: transcription.language
    });
    transcriptText = buildTranscriptText(diarizedTranscript);
    logger.info({ sessionId }, "reprocess: transcript translated to English");
  }

  // 3b. Caption fallback — same rules as the orchestrator: empty transcript, or
  // (whisper only) garbage output per the reliability check.
  const captionSpeechExists = hasSpeechCaptionEvidence(captions);
  if (captionSpeechExists) {
    const speech = await analyzeSpeech(audioPath);
    const whisperQuality =
      transcription.provider === "whisper" && diarizedTranscript.length > 0
        ? assessWhisperReliability(diarizedTranscript, captions, speech.speechSeconds)
        : undefined;
    if (diarizedTranscript.length === 0 || whisperQuality?.unreliable) {
      const fallbackReason = whisperQuality?.unreliable ? whisperQuality.reason : "no_speech";
      diarizedTranscript = buildCaptionDerivedTranscript(captions, { meetingStartedAt: startedAt });
      transcriptText = buildTranscriptText(diarizedTranscript);
      logger.warn(
        { sessionId, fallbackReason, whisperQuality, captionSegmentCount: diarizedTranscript.length },
        "reprocess: provider transcript unusable; using caption-derived transcript fallback"
      );
    }
  }

  logger.info(
    { sessionId, afterSpeakers: speakerCounts(diarizedTranscript), transcriptTextLength: transcriptText.length },
    "reprocess: speaker mapping complete (AFTER state)"
  );

  let updates: Record<string, unknown> = {
    diarizedTranscript,
    transcriptText,
    transcriptionProvider: transcription.provider,
    meetingLanguage: transcription.language
  };

  // 4. Summary + MoM (unless --transcript-only) ──────────────────────────────
  if (!options.transcriptOnly) {
    const summary = await new SummaryService(logger).summarize({ participants, transcript: diarizedTranscript, transcriptText });
    diarizedTranscript = summary.transcriptWithSentiment;
    const meetingName = summary.shortTitle?.trim() || session.meetingName;
    const durationSeconds = session.startedAt && session.endedAt ? Math.max(0, (new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000) : 0;

    const momReport = await new MomReportService(logger).generate({
      meetingTitle: meetingName?.trim() || summary.summary?.split(/[.!?]/)[0]?.trim() || sessionId,
      summary: summary.summary,
      participants,
      transcript: diarizedTranscript,
      transcriptText,
      actionItems: summary.actionItems,
      sentimentSummary: summary.sentimentSummary,
      durationSeconds,
      meetingDate: startedAt
    });

    updates = {
      diarizedTranscript,
      transcriptText,
      transcriptionProvider: transcription.provider,
      meetingLanguage: transcription.language,
      summary: summary.summary,
      meetingName,
      chapters: summary.chapters,
      actionItems: summary.actionItems,
      sentimentSummary: summary.sentimentSummary,
      momReport
    };
    logger.info({ sessionId, summaryLength: summary.summary.length, source: summary.source }, "reprocess: summary + MoM regenerated");
  }

  if (options.dryRun) {
    logger.info({ sessionId, finalSpeakers: speakerCounts(diarizedTranscript as DiarizedTranscriptSegment[]) }, "[dry-run] reprocess complete (NOT saved)");
    return;
  }

  await BotSessionModel.updateOne({ sessionId }, { $set: updates });
  logger.info({ sessionId, finalSpeakers: speakerCounts(diarizedTranscript as DiarizedTranscriptSegment[]) }, "reprocess complete and saved");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const transcriptOnly = args.includes("--transcript-only");
  const sessionIds = args.filter((arg) => !arg.startsWith("-"));

  if (!sessionIds.length) {
    console.error("Usage: npm run session:reprocess -- <sessionId> [<sessionId> ...] [--dry-run] [--transcript-only]");
    process.exit(1);
  }

  await connectMongo();
  try {
    for (const sessionId of sessionIds) {
      await reprocess(sessionId, { dryRun, transcriptOnly });
    }
  } finally {
    await disconnectMongo();
  }
}

main().catch((error) => {
  logger.error({ err: error }, "reprocess-session failed");
  process.exit(1);
});
