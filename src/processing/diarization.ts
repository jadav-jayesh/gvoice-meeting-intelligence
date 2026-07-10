import type { DiarizedTranscriptSegment } from "../types/meeting";

const noisePattern = /^(uh|um|hmm|mm|music|silence|noise|\[.*?\]|\(.*?\))$/iu;

export function normalizeDiarizedTranscript(segments: DiarizedTranscriptSegment[]): DiarizedTranscriptSegment[] {
  const cleaned = segments
    .map((segment) => ({
      ...segment,
      speaker: normalizeSpeakerLabel(segment.speaker),
      text: collapseRepetitiveText(normalizeTranscriptText(segment.text)),
      startTime: Math.max(0, Number(segment.startTime) || 0),
      endTime: Math.max(0, Number(segment.endTime) || 0),
      confidence: typeof segment.confidence === "number" ? Math.max(0, Math.min(1, segment.confidence)) : undefined
    }))
    .filter((segment) => segment.text && segment.endTime > segment.startTime)
    .filter((segment) => !noisePattern.test(segment.text))
    .filter((segment) => !isHallucinatedRepeat(segment.text));

  cleaned.sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);

  const noOverlaps = removeOverlaps(cleaned);
  const dedup = removeCrossSpeakerTextOverlap(noOverlaps);
  return mergeNearbySameSpeaker(dedup);
}

// STT providers (notably Sarvam) sometimes hallucinate during low-confidence
// audio, emitting one short token repeated dozens of times — e.g.
// "દુરુ દુરુ દુરુ દુરુ ..." in the Gujarati Zoom session. Collapse runs of
// ≥4 identical adjacent tokens down to two, so the segment retains some
// signal without dominating the transcript.
function collapseRepetitiveText(text: string): string {
  if (!text) return text;
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 4) return text;

  const collapsed: string[] = [];
  let runToken = "";
  let runLength = 0;
  for (const token of tokens) {
    if (token === runToken) {
      runLength += 1;
      if (runLength <= 2) collapsed.push(token);
      continue;
    }
    runToken = token;
    runLength = 1;
    collapsed.push(token);
  }
  return collapsed.join(" ");
}

// If a segment is mostly one repeated token (e.g. >70% of its tokens are the
// same word and the segment is at least 8 tokens long), it's almost certainly
// a hallucination from the STT — drop it entirely instead of letting a
// nonsense line pollute the transcript and the speaker resolver.
function isHallucinatedRepeat(text: string): boolean {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 8) return false;
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  const topCount = Math.max(...counts.values());
  return topCount / tokens.length >= 0.7;
}

// Remove cross-speaker text duplication. The diarizer occasionally splits a
// single utterance across two speaker clusters when speech overlaps or when
// the speaker change is uncertain — the second segment's text then starts
// with the first segment's full text repeated. Strip that prefix so each
// utterance is attributed cleanly to one speaker.
function removeCrossSpeakerTextOverlap(segments: DiarizedTranscriptSegment[]): DiarizedTranscriptSegment[] {
  const result: DiarizedTranscriptSegment[] = [];

  for (const segment of segments) {
    const previous = result[result.length - 1];
    if (!previous || previous.speaker === segment.speaker) {
      result.push({ ...segment });
      continue;
    }

    const trimmed = stripPrefixOverlap(previous.text, segment.text);
    if (!trimmed) continue; // entire current text was a duplicate of previous
    if (trimmed === segment.text) {
      result.push({ ...segment });
      continue;
    }
    result.push({ ...segment, text: trimmed });
  }

  return result;
}

// Returns `current` with any leading run of tokens that also appear inside
// `previous` removed. The diarizer's cross-speaker duplication shows up in
// two shapes:
//   (a) clean suffix-prefix overlap: previous ends with X, current starts
//       with X (often differing only in trailing punctuation).
//   (b) substring overlap: previous fully contains the prefix of current as
//       a contiguous run somewhere inside it (the diarizer split one
//       utterance and assigned the middle portion to the wrong speaker).
// Both shapes are handled by the same algorithm: find the longest prefix of
// `current` that appears as a contiguous run anywhere in `previous` (using
// punctuation-stripped, case-insensitive comparison) and strip it.
function stripPrefixOverlap(previous: string, current: string): string {
  const previousTokens = previous.split(/\s+/).filter(Boolean);
  const currentTokens = current.split(/\s+/).filter(Boolean);
  if (previousTokens.length === 0 || currentTokens.length === 0) return current;

  const normPrev = previousTokens.map(normalizeTokenForOverlap);
  const normCurr = currentTokens.map(normalizeTokenForOverlap);

  const maxOverlap = Math.min(normPrev.length, normCurr.length);
  let bestOverlap = 0;
  outer: for (let size = maxOverlap; size >= 1; size -= 1) {
    const target = normCurr.slice(0, size);
    for (let start = 0; start <= normPrev.length - size; start += 1) {
      let matched = true;
      for (let index = 0; index < size; index += 1) {
        if (normPrev[start + index] !== target[index]) {
          matched = false;
          break;
        }
      }
      if (matched) {
        bestOverlap = size;
        break outer;
      }
    }
  }

  if (bestOverlap === 0) return current;
  // Require either ≥3 tokens of overlap OR an overlap that covers ≥60% of
  // the current segment. This avoids stripping legitimate single-word
  // transitions like "yes" / "yes I agree".
  if (bestOverlap < 3 && bestOverlap / currentTokens.length < 0.6) return current;

  return currentTokens.slice(bestOverlap).join(" ").trim();
}

function normalizeTokenForOverlap(token: string): string {
  return token
    .toLocaleLowerCase()
    // Strip leading/trailing punctuation in any script (Latin, Devanagari,
    // Gujarati, CJK punctuation, smart quotes). Keeps internal hyphens
    // intact for words like "Zoom-માં".
    .replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
}

function removeOverlaps(segments: DiarizedTranscriptSegment[]): DiarizedTranscriptSegment[] {
  const result: DiarizedTranscriptSegment[] = [];

  for (const segment of segments) {
    const previous = result[result.length - 1];
    const next = { ...segment };

    if (previous && next.startTime < previous.endTime) {
      next.startTime = previous.endTime;
      if (next.endTime <= next.startTime) continue;
    }

    result.push(next);
  }

  return result;
}

function mergeNearbySameSpeaker(segments: DiarizedTranscriptSegment[]): DiarizedTranscriptSegment[] {
  const merged: DiarizedTranscriptSegment[] = [];

  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    const gap = previous ? segment.startTime - previous.endTime : Number.POSITIVE_INFINITY;
    const sameSpeaker = previous?.speaker === segment.speaker;
    const canMerge = previous && sameSpeaker && gap >= 0 && gap <= 1.2 && previous.text.length + segment.text.length <= 900;

    if (canMerge) {
      previous.text = `${previous.text} ${segment.text}`.replace(/\s+/g, " ").trim();
      previous.endTime = segment.endTime;
      previous.confidence = averageConfidence(previous.confidence, segment.confidence);
    } else {
      merged.push({ ...segment });
    }
  }

  return merged;
}

function averageConfidence(left?: number, right?: number): number | undefined {
  if (typeof left === "number" && typeof right === "number") return (left + right) / 2;
  return left ?? right;
}

function normalizeSpeakerLabel(speaker: string | undefined): string {
  const normalized = (speaker ?? "").replace(/\s+/g, " ").trim();
  return normalized || "Speaker A";
}

function normalizeTranscriptText(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}
