import type { DiarizedTranscriptSegment } from "../types/meeting";

// Provider identifier carried on every transcription result so downstream code
// (and logs) can tell where a transcript came from without changing behaviour.
// "whisper" is the Azure Whisper + Pyannote pipeline; the rest are pre-existing.
export type TranscriptionProvider = "azure" | "sarvam" | "whisper" | "mock";

export interface TranscriptionResult {
  provider: TranscriptionProvider;
  language?: string;
  text: string;
  segments: DiarizedTranscriptSegment[];
  raw?: unknown;
}

export interface Transcriber {
  transcribe(audioPath: string): Promise<TranscriptionResult>;
}

// ── Azure Whisper verbose_json shapes ───────────────────────────────────────
// What the Whisper transcriber returns after parsing Azure's `verbose_json`
// response. Word-level timestamps are required for overlap-based speaker
// assignment (a word is attributed to the diarization span that contains it).
export interface WhisperWord {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface WhisperSegment {
  id?: number;
  text: string;
  start: number;
  end: number;
  // Whisper's per-segment acoustic signals (present on whole-file decodes).
  avgLogprob?: number;
  noSpeechProb?: number;
}

export interface WhisperResult {
  text: string;
  language?: string;
  words: WhisperWord[];
  segments: WhisperSegment[];
  // Offset (seconds) applied to every timestamp. Non-zero when this result came
  // from transcribing a sliced region/chunk of the original audio, so callers
  // can map timings back onto the full-meeting timeline.
  offsetSeconds?: number;
  raw?: unknown;
}

// ── Pyannote diarization shapes ─────────────────────────────────────────────
// A contiguous span of speech attributed to a single diarization cluster.
// `speaker` is a stable label like "SPEAKER_00" produced by pyannote.
export interface DiarizationSpan {
  speaker: string;
  start: number;
  end: number;
}

export interface DiarizationResult {
  spans: DiarizationSpan[];
  speakerCount: number;
  raw?: unknown;
}
