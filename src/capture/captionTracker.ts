import { cleanParticipantName } from "../processing/participants";
import { canonicalCaptionText, isSystemCaptionText, normalizeCaptionText } from "../processing/captions";
import type { CaptionTimelineEntry } from "../types/meeting";

interface CaptionTrackerOptions {
  duplicateWindowMs?: number;
  staleWindowMs?: number;
}

export class CaptionTracker {
  private readonly captions: CaptionTimelineEntry[] = [];
  private readonly duplicateWindowMs: number;
  private readonly staleWindowMs: number;

  constructor(options: CaptionTrackerOptions = {}) {
    this.duplicateWindowMs = options.duplicateWindowMs ?? 5000;
    this.staleWindowMs = options.staleWindowMs ?? 60000;
  }

  add(rawCaption: Omit<CaptionTimelineEntry, "source"> & { source?: "ui_caption" }): CaptionTimelineEntry | null {
    const text = normalizeCaptionText(rawCaption.text);
    if (!text) return null;
    if (isSystemCaptionText(text)) return null;

    const speaker = cleanParticipantName(rawCaption.speaker);
    if (!speaker) return null;

    const caption: CaptionTimelineEntry = {
      speaker,
      text,
      time: rawCaption.time,
      source: "ui_caption"
    };

    if (this.mergeOrRejectDuplicate(caption)) return null;
    this.captions.push(caption);
    return caption;
  }

  addMany(captions: Array<Omit<CaptionTimelineEntry, "source"> & { source?: "ui_caption" }>): CaptionTimelineEntry[] {
    return captions.map((caption) => this.add(caption)).filter((caption): caption is CaptionTimelineEntry => Boolean(caption));
  }

  values(): CaptionTimelineEntry[] {
    return [...this.captions].sort((a, b) => a.time.getTime() - b.time.getTime());
  }

  private mergeOrRejectDuplicate(caption: CaptionTimelineEntry): boolean {
    const captionTime = caption.time.getTime();
    const candidateText = canonicalCaptionText(caption.text);

    for (let index = this.captions.length - 1; index >= 0; index -= 1) {
      const existing = this.captions[index];
      const delta = captionTime - existing.time.getTime();
      if (delta > this.staleWindowMs) break;

      const compatibleSpeaker = !existing.speaker || !caption.speaker || existing.speaker === caption.speaker;
      const existingText = canonicalCaptionText(existing.text);
      const sameText = existingText === candidateText;
      const progressiveText =
        compatibleSpeaker &&
        candidateText.length >= 4 &&
        existingText.length >= 4 &&
        (candidateText.includes(existingText) ||
          existingText.includes(candidateText) ||
          isFuzzyProgressiveCaption(existing.text, caption.text) ||
          isFuzzyProgressiveCaption(caption.text, existing.text));

      if (sameText && compatibleSpeaker && delta <= this.duplicateWindowMs) return true;
      if (sameText && delta <= this.staleWindowMs) return true;
      if (progressiveText) {
        if (candidateText.length > existingText.length) {
          existing.text = caption.text;
          existing.time = caption.time;
          existing.speaker = existing.speaker ?? caption.speaker;
        }
        return true;
      }
    }

    return false;
  }
}

function isFuzzyProgressiveCaption(olderText: string, newerText: string): boolean {
  const olderWords = canonicalCaptionText(olderText).split(/\s+/).filter(Boolean);
  const newerWords = canonicalCaptionText(newerText).split(/\s+/).filter(Boolean);
  if (olderWords.length < 6 || newerWords.length <= olderWords.length) return false;

  const compared = Math.min(olderWords.length, newerWords.length);
  let samePositionMatches = 0;
  for (let index = 0; index < compared; index += 1) {
    if (olderWords[index] === newerWords[index]) samePositionMatches += 1;
  }
  if (samePositionMatches / olderWords.length >= 0.65) return true;

  let orderedMatches = 0;
  let newerIndex = 0;
  for (const word of olderWords) {
    while (newerIndex < newerWords.length && newerWords[newerIndex] !== word) newerIndex += 1;
    if (newerIndex >= newerWords.length) break;
    orderedMatches += 1;
    newerIndex += 1;
  }

  return orderedMatches / olderWords.length >= 0.8;
}
