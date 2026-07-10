import type { DiarizedTranscriptSegment } from "../../types/meeting";
import type { DiarizationSpan, WhisperResult, WhisperWord } from "../types";

// A timed unit of transcript to attribute to a speaker. Words are preferred
// (fine-grained, accurate overlap); whole Whisper segments are the fallback
// when a deployment returns no word-level timestamps.
interface TimedUnit {
  text: string;
  start: number;
  end: number;
}

export interface MergeOptions {
  // Start a new segment when the silent gap between consecutive same-speaker
  // units exceeds this (seconds). Keeps monologues from collapsing into one
  // giant segment, which would hurt the timeline / per-segment sentiment.
  maxGapSeconds?: number;
  // Soft cap on a segment's character length before it is split (same speaker).
  maxChars?: number;
}

const DEFAULT_MAX_GAP_SECONDS = 1.5;
const DEFAULT_MAX_CHARS = 320;
const FALLBACK_SPEAKER = "SPEAKER_00";

/**
 * STEP 3 — overlap-based speaker assignment + grouping.
 *
 * For every Whisper word we find the diarization span that *contains* it (by
 * time overlap, NOT nearest timestamp), attribute the word to that speaker,
 * then group consecutive same-speaker words into transcript segments. The
 * resulting `clusterId` is the stable pyannote label (SPEAKER_00…), which the
 * existing speakerMapper/resolver consume to attach real participant names.
 */
export function mergeTranscriptWithDiarization(
  whisper: WhisperResult,
  spans: DiarizationSpan[],
  options: MergeOptions = {}
): DiarizedTranscriptSegment[] {
  const units = toTimedUnits(whisper);
  if (units.length === 0) return [];

  const assigned = units.map((unit) => ({ unit, ...assignSpeaker(unit, spans) }));
  return groupBySpeaker(assigned, options);
}

/** Assign each word to its containing/overlapping diarization span. */
export function assignWordsToSpeakers(
  words: WhisperWord[],
  spans: DiarizationSpan[]
): Array<WhisperWord & { speaker: string; overlapRatio: number }> {
  return words.map((word) => {
    const { speaker, overlapRatio } = assignSpeaker(word, spans);
    return { ...word, speaker, overlapRatio };
  });
}

function toTimedUnits(whisper: WhisperResult): TimedUnit[] {
  if (whisper.words.length > 0) {
    return whisper.words.map((word) => ({ text: word.word, start: word.start, end: word.end }));
  }
  return whisper.segments.map((segment) => ({ text: segment.text, start: segment.start, end: segment.end }));
}

/**
 * Returns the speaker for a unit and a 0..1 confidence proxy. Preference order:
 *   1. the span with the greatest temporal overlap (the unit's midpoint or any
 *      part of it falls inside a span);
 *   2. when nothing overlaps (diarization gap), the nearest span by distance.
 * The overlap ratio feeds the segment confidence so downstream quality gates
 * can tell solid attributions from nearest-window guesses.
 */
function assignSpeaker(unit: { start: number; end: number }, spans: DiarizationSpan[]): { speaker: string; overlapRatio: number } {
  if (spans.length === 0) return { speaker: FALLBACK_SPEAKER, overlapRatio: 0 };

  const duration = Math.max(1e-3, unit.end - unit.start);
  let bestSpeaker = "";
  let bestOverlap = 0;
  for (const span of spans) {
    const overlap = Math.max(0, Math.min(unit.end, span.end) - Math.max(unit.start, span.start));
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestSpeaker = span.speaker;
    }
  }

  if (bestOverlap > 0) {
    return { speaker: bestSpeaker, overlapRatio: Math.min(1, bestOverlap / duration) };
  }

  // No overlap: fall back to the nearest span (diarization rarely covers 100%
  // of the audio, so word boundaries can land in silence gaps between spans).
  const mid = (unit.start + unit.end) / 2;
  let nearest = spans[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const span of spans) {
    const distance = mid < span.start ? span.start - mid : mid > span.end ? mid - span.end : 0;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = span;
    }
  }
  return { speaker: nearest.speaker, overlapRatio: 0 };
}

function groupBySpeaker(
  assigned: Array<{ unit: TimedUnit; speaker: string; overlapRatio: number }>,
  options: MergeOptions
): DiarizedTranscriptSegment[] {
  const maxGap = options.maxGapSeconds ?? DEFAULT_MAX_GAP_SECONDS;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

  const segments: DiarizedTranscriptSegment[] = [];
  let current: (DiarizedTranscriptSegment & { overlapSum: number; overlapCount: number }) | null = null;

  for (const { unit, speaker, overlapRatio } of assigned) {
    const text = unit.text.trim();
    if (!text) continue;

    const speakerChanged = current !== null && current.clusterId !== speaker;
    const gap = current ? unit.start - current.endTime : 0;
    const tooLong = current ? current.text.length + text.length + 1 > maxChars : false;

    if (!current || speakerChanged || gap > maxGap || tooLong) {
      if (current) segments.push(finalizeSegment(current));
      current = {
        speaker,
        clusterId: speaker,
        text,
        startTime: unit.start,
        endTime: unit.end,
        overlapSum: overlapRatio,
        overlapCount: 1
      };
      continue;
    }

    current.text = joinText(current.text, text);
    current.endTime = Math.max(current.endTime, unit.end);
    current.overlapSum += overlapRatio;
    current.overlapCount += 1;
  }

  if (current) segments.push(finalizeSegment(current));
  return segments;
}

function finalizeSegment(segment: DiarizedTranscriptSegment & { overlapSum: number; overlapCount: number }): DiarizedTranscriptSegment {
  const meanOverlap = segment.overlapCount > 0 ? segment.overlapSum / segment.overlapCount : 0;
  return {
    speaker: segment.speaker,
    clusterId: segment.clusterId,
    text: segment.text,
    startTime: round(segment.startTime),
    endTime: round(Math.max(segment.endTime, segment.startTime + 0.01)),
    confidence: combineConfidence(meanOverlap)
  };
}

// Whisper rarely returns usable per-word acoustic confidence on this Azure
// deployment, so the confidence we expose is driven by the diarization overlap:
// a fully-contained run scores high, a nearest-window guess scores low. Callers
// must treat this as an attribution-confidence proxy, not an ASR score.
function combineConfidence(meanOverlap: number): number {
  if (meanOverlap <= 0) return 0.4;
  return Math.min(1, 0.55 + meanOverlap * 0.45);
}

function joinText(existing: string, next: string): string {
  if (!existing) return next;
  // No space before clitic punctuation; otherwise space-join (works for Latin
  // and Indic scripts, which also use spaces between words).
  if (/^[.,!?;:%]/.test(next)) return `${existing}${next}`;
  return `${existing} ${next}`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
