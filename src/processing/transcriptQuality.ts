import type { CaptionTimelineEntry, DiarizedTranscriptSegment } from "../types/meeting";

// Quality gate for Whisper output. Azure Whisper cannot decode some of this
// team's audio (notably Gujarati — hard platform limit); instead of returning
// empty it often hallucinates a few tiny, near-identical segments on background
// noise (e.g. "Apne apne" ×4 at ~30s intervals) while missing the real speech
// entirely. The orchestrator's caption fallback historically fired only on a
// fully EMPTY transcript, so this garbage was kept and the rich live captions
// were ignored. This module detects that failure shape so the caption-derived
// transcript can be used instead.
//
// Used ONLY for the whisper provider — the Sarvam flow is never gated.

export interface WhisperReliabilityAssessment {
  unreliable: boolean;
  reason?: "low_speech_coverage" | "hallucinated_repeats";
  metrics: {
    transcriptSeconds: number;
    speechSeconds?: number;
    coverage?: number;
    transcriptChars: number;
    captionChars: number;
    segmentCount: number;
    distinctTexts: number;
  };
}

// Transcript must cover at least this fraction of the detected speech to be
// trusted when captions are substantially richer.
const MIN_SPEECH_COVERAGE = 0.2;
// Captions must have at least this multiple of the transcript's text to be
// considered the richer source (guards against replacing a quiet-but-solid
// transcript with sparse captions).
const CAPTION_RICHNESS_MULTIPLE = 2;
// "All segments are the same short phrase" only counts as a hallucination
// signature with at least this many segments.
const MIN_REPEAT_SEGMENTS = 3;

export function assessWhisperReliability(
  segments: DiarizedTranscriptSegment[],
  captions: CaptionTimelineEntry[],
  speechSeconds?: number
): WhisperReliabilityAssessment {
  const transcriptSeconds = segments.reduce((total, segment) => total + Math.max(0, segment.endTime - segment.startTime), 0);
  const transcriptChars = segments.reduce((total, segment) => total + segment.text.trim().length, 0);
  const captionChars = captions.reduce((total, caption) => total + caption.text.trim().length, 0);
  const distinctTexts = new Set(segments.map((segment) => normalizeForComparison(segment.text))).size;
  const coverage = speechSeconds && speechSeconds > 0 ? transcriptSeconds / speechSeconds : undefined;

  const metrics = {
    transcriptSeconds: round(transcriptSeconds),
    speechSeconds: speechSeconds !== undefined ? round(speechSeconds) : undefined,
    coverage: coverage !== undefined ? round(coverage) : undefined,
    transcriptChars,
    captionChars,
    segmentCount: segments.length,
    distinctTexts
  };

  if (segments.length === 0) return { unreliable: false, metrics };

  const captionsRicher = captionChars >= transcriptChars * CAPTION_RICHNESS_MULTIPLE;
  if (!captionsRicher) return { unreliable: false, metrics };

  // Signature 1: every segment is the same short phrase repeated — Whisper's
  // noise-hallucination loop. Real meetings never produce 3+ identical-only
  // segments as the ENTIRE transcript.
  if (segments.length >= MIN_REPEAT_SEGMENTS && distinctTexts === 1) {
    return { unreliable: true, reason: "hallucinated_repeats", metrics };
  }

  // Signature 2: the transcript covers almost none of the speech ffmpeg
  // detected, while captions caught far more — Whisper skipped the audio.
  if (coverage !== undefined && coverage < MIN_SPEECH_COVERAGE) {
    return { unreliable: true, reason: "low_speech_coverage", metrics };
  }

  return { unreliable: false, metrics };
}

function normalizeForComparison(text: string): string {
  return text
    .toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
