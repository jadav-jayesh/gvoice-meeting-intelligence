import { canonicalCaptionText, isSpeechCaption, normalizeCaptionText } from "./captions";
import { cleanParticipantName } from "./participants";
import type { CaptionTimelineEntry, DiarizedTranscriptSegment } from "../types/meeting";

interface CaptionTranscriptOptions {
  meetingStartedAt?: Date;
}

export function buildCaptionDerivedTranscript(
  captions: CaptionTimelineEntry[],
  options: CaptionTranscriptOptions = {}
): DiarizedTranscriptSegment[] {
  const ordered = [...captions].filter(isSpeechCaption).sort((a, b) => a.time.getTime() - b.time.getTime());
  if (ordered.length === 0) return [];

  const originMs = options.meetingStartedAt?.getTime() ?? ordered[0].time.getTime();
  const lastFullTextBySpeaker = new Map<string, string>();
  const segments: DiarizedTranscriptSegment[] = [];
  let lastEndTime = 0;

  for (const caption of ordered) {
    const speaker = cleanParticipantName(caption.speaker) ?? "Speaker A";
    const speakerKey = speaker.toLocaleLowerCase("en-US");
    const fullText = removeEmbeddedSpeakerLabels(caption.text, speaker);
    const previousFullText = lastFullTextBySpeaker.get(speakerKey) ?? "";
    const deltaText = captionDelta(previousFullText, fullText);
    lastFullTextBySpeaker.set(speakerKey, fullText);

    if (!deltaText || canonicalCaptionText(deltaText) === canonicalCaptionText(previousFullText)) continue;

    const captionEndTime = Math.max(0.01, (caption.time.getTime() - originMs) / 1000);
    const estimatedDuration = Math.max(1, Math.min(12, deltaText.split(/\s+/).filter(Boolean).length * 0.42));
    const startTime = Math.max(lastEndTime, captionEndTime - estimatedDuration);
    const endTime = Math.max(startTime + 0.01, captionEndTime);

    segments.push({
      speaker,
      text: deltaText,
      startTime,
      endTime,
      confidence: 0.55,
      clusterId: `caption:${speakerKey}`
    });
    lastEndTime = endTime;
  }

  return segments;
}

function removeEmbeddedSpeakerLabels(text: string, speaker: string): string {
  const normalized = normalizeCaptionText(text);
  if (!speaker || /^speaker\s+[a-z]$/i.test(speaker)) return normalized;

  const escapedSpeaker = speaker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return normalized
    .replace(new RegExp(`\\b${escapedSpeaker}\\b\\s*`, "giu"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

function captionDelta(previousText: string, currentText: string): string {
  const current = normalizeCaptionText(currentText);
  if (!current) return "";
  const previousCanonical = canonicalCaptionText(previousText);
  const currentCanonical = canonicalCaptionText(current);
  if (!previousCanonical) return current;
  if (!currentCanonical || currentCanonical === previousCanonical) return "";

  const currentTokens = current.split(/\s+/).filter(Boolean);
  const currentCanonicalTokens = currentTokens.map(canonicalCaptionText);
  const previousCanonicalTokens = previousCanonical.split(/\s+/).filter(Boolean);
  if (currentCanonicalTokens.length <= previousCanonicalTokens.length && isOrderedSubset(currentCanonicalTokens, previousCanonicalTokens)) {
    return "";
  }

  const overlap = longestSuffixPrefixOverlap(previousCanonicalTokens, currentCanonicalTokens);
  if (overlap >= Math.min(previousCanonicalTokens.length, currentCanonicalTokens.length) * 0.55) {
    return currentTokens.slice(overlap).join(" ").trim();
  }

  const prefixMatches = commonPrefixLength(previousCanonicalTokens, currentCanonicalTokens);
  if (prefixMatches >= Math.min(previousCanonicalTokens.length, currentCanonicalTokens.length) * 0.55) {
    return currentTokens.slice(prefixMatches).join(" ").trim();
  }

  return current;
}

function longestSuffixPrefixOverlap(left: string[], right: string[]): number {
  const max = Math.min(left.length, right.length);
  for (let size = max; size >= 1; size -= 1) {
    let matches = 0;
    for (let index = 0; index < size; index += 1) {
      if (left[left.length - size + index] === right[index]) matches += 1;
    }
    if (matches / size >= 0.9) return size;
  }
  return 0;
}

function commonPrefixLength(left: string[], right: string[]): number {
  const max = Math.min(left.length, right.length);
  let matches = 0;
  for (let index = 0; index < max; index += 1) {
    if (left[index] !== right[index]) break;
    matches += 1;
  }
  return matches;
}

function isOrderedSubset(left: string[], right: string[]): boolean {
  let rightIndex = 0;
  for (const word of left) {
    while (rightIndex < right.length && right[rightIndex] !== word) rightIndex += 1;
    if (rightIndex >= right.length) return false;
    rightIndex += 1;
  }
  return true;
}
