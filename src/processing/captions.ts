import type { CaptionTimelineEntry } from "../types/meeting";

const systemCaptionPatterns = [
  /\bcaptions?\s+(?:are\s+)?(?:turned|switched)\s+(?:on|off)\b/i,
  /\blive captions?\s+(?:are\s+)?(?:on|off|enabled|disabled)\b/i,
  /\btranscription\s+(?:has\s+)?(?:started|stopped|ended)\b/i,
  /\brecording\s+(?:has\s+)?(?:started|stopped|ended)\b/i,
  /\bteams?\s+needs?\s+permission\b/i,
  /\bpermission\s+to\s+access\s+your\s+(?:mic|microphone|camera)\b/i,
  /\bprivacy settings?\b/i,
  /\bno\s+(?:microphone|camera)\s+(?:was\s+)?found\b/i,
  /\b(?:mic|microphone|camera|videocam)\s+not\s+found\b/i,
  /\bplug one in\b/i,
  /\benjoy just listening in\b/i,
  /\bmake sure no other app is using your camera and mic\b/i,
  /^your camera is turned off\.?$/i,
  /^(?:camera|microphone|mic)\s+is\s+off\.?$/i,
  /^unknown user joined the conversation\.?$/i,
  /\bjoined the conversation\.?$/i,
  /^continue without audio or video$/i,
  /^computer audio$/i,
  /^phone audio$/i,
  /^don'?t use audio$/i,
  /^dummy output$/i,
  /^type your name$/i,
  /^join now$/i,
  /^cancel$/i,
  /^\d+\s+after\s+\d+\s+minutes?\s+\d+\s+seconds?$/i
];

const controlCaptionPattern =
  /\b(?:turn on|turn off|hide|show|live captions|live transcript|captions and subtitles|spoken language|translated|settings|more actions|keyboard shortcuts|meeting options)\b/i;

export function normalizeCaptionText(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim();
}

export function canonicalCaptionText(text: string): string {
  return normalizeCaptionText(text)
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isSystemCaptionText(text: string | null | undefined): boolean {
  const normalized = normalizeCaptionText(text);
  if (!normalized) return true;
  if (systemCaptionPatterns.some((pattern) => pattern.test(normalized))) return true;

  const words = normalized.split(/\s+/);
  if (words.length <= 5 && controlCaptionPattern.test(normalized)) return true;

  return false;
}

export function isSpeechCaption(caption: Pick<CaptionTimelineEntry, "text">): boolean {
  const text = normalizeCaptionText(caption.text);
  if (isSystemCaptionText(text)) return false;
  return /\p{L}/u.test(text);
}

export function hasSpeechCaptionEvidence(captions: CaptionTimelineEntry[]): boolean {
  const speechCaptions = captions.filter(isSpeechCaption);
  const totalWords = speechCaptions.reduce((count, caption) => count + caption.text.split(/\s+/).filter(Boolean).length, 0);
  return speechCaptions.length > 0 && totalWords >= 3;
}

// Build the lowercased name lookup used by isRosterNameCaption. It holds both
// each full display name AND its individual tokens, so "Krunal Panchal" matches
// a roster that only knows the first name "Krunal".
export function buildRosterNameSet(names: Iterable<string>): Set<string> {
  const set = new Set<string>();
  for (const raw of names) {
    const normalized = normalizeCaptionText(raw).toLocaleLowerCase("en-US");
    if (!normalized) continue;
    set.add(normalized);
    for (const token of normalized.split(/\s+/).filter(Boolean)) set.add(token);
  }
  return set;
}

// A caption whose *text* is merely a participant's on-screen name — a roster
// tile / nameplate the scraper mistook for a caption — is NOT speech. When a
// meeting's live captions are off, the DOM scraper can latch onto a name label
// and store rows like { speaker: "Ashok", text: "Krunal Panchal" } on a fixed
// cadence. Ingested as speech, these silently wreck speaker attribution: the
// dominant voice cluster gets bound to whoever the fake caption names, and the
// real names collapse into guesses.
//
// Kept deliberately conservative so genuine short utterances survive:
//   - roster-gated: with an empty roster nothing is ever dropped;
//   - anything carrying sentence punctuation (. ? ! , ; :) is treated as speech;
//   - only lines of <=3 bare word-tokens are eligible;
//   - at least one token must match a KNOWN participant name.
export function isRosterNameCaption(text: string, rosterNames: Set<string>): boolean {
  const normalized = normalizeCaptionText(text);
  if (!normalized || rosterNames.size === 0) return false;
  if (/[.?!,;:]/u.test(normalized)) return false;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 3) return false;
  const lower = tokens.map((token) => token.toLocaleLowerCase("en-US"));
  if (rosterNames.has(lower.join(" "))) return true;
  const allWordTokens = tokens.every((token) => /^[\p{L}\p{M}'-]+$/u.test(token));
  return allWordTokens && lower.some((token) => rosterNames.has(token));
}
