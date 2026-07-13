import { cleanParticipantName } from "./participants";
import type { DiarizedTranscriptSegment } from "../types/meeting";

// The Microsoft Teams OFFICIAL transcript (Graph) labels every line with the
// exact speaker. When we have it, it is ground truth — far more reliable than
// audio diarisation guessing which similar voice is which. This module overlays
// those authoritative speaker names onto the (higher-text-quality) audio
// transcript by time-alignment, so we keep Sarvam/Whisper text but get Teams'
// correct speakers.

export interface SpeakerSpan {
  speaker: string;
  start: number;
  end: number;
}

// Reconcile a Teams full name ("Sagar Patel") to a stored participant short name
// ("Sagar") by exact then first-token match; fall back to the Teams first name
// (a real person who spoke) so we never invent or drop a speaker.
export function reconcileSpeakerName(teamsName: string, participants: string[]): string {
  const clean = cleanParticipantName(teamsName) || teamsName.trim();
  if (!clean) return teamsName.trim();
  const lower = clean.toLocaleLowerCase("en-US");
  const exact = participants.find((p) => p.toLocaleLowerCase("en-US") === lower);
  if (exact) return exact;
  const firstToken = lower.split(/\s+/)[0];
  const byFirst = participants.find((p) => p.toLocaleLowerCase("en-US").split(/\s+/)[0] === firstToken);
  if (byFirst) return byFirst;
  return clean.split(/\s+/)[0] || clean;
}

// The audio recording starts when the bot joins — a little after the meeting
// (and its Teams transcript) began — so the two clocks differ by a roughly
// constant offset. Estimate it by aligning the earliest timestamps.
export function estimateClockOffset(segmentStarts: number[], spans: SpeakerSpan[]): number {
  if (segmentStarts.length === 0 || spans.length === 0) return 0;
  const segMin = Math.min(...segmentStarts);
  const teamsMin = Math.min(...spans.map((s) => s.start));
  return teamsMin - segMin;
}

// Speaker with the greatest time-overlap with [start,end] (shifted by offset).
// If nothing overlaps (a gap between spans), fall back to the nearest span so
// every segment is attributed to a real Teams speaker.
export function bestOverlapSpeaker(start: number, end: number, spans: SpeakerSpan[], offset: number): string | undefined {
  if (spans.length === 0) return undefined;
  const s0 = start + offset;
  const e0 = end + offset;
  const overlap = new Map<string, number>();
  for (const s of spans) {
    const o = Math.min(e0, s.end) - Math.max(s0, s.start);
    if (o > 0) overlap.set(s.speaker, (overlap.get(s.speaker) ?? 0) + o);
  }
  let best: string | undefined;
  let bestVal = 0;
  for (const [sp, v] of overlap) if (v > bestVal) { best = sp; bestVal = v; }
  if (best) return best;
  const mid = (s0 + e0) / 2;
  let nearest: string | undefined;
  let nearestDist = Infinity;
  for (const s of spans) {
    const dist = mid < s.start ? s.start - mid : mid > s.end ? mid - s.end : 0;
    if (dist < nearestDist) { nearestDist = dist; nearest = s.speaker; }
  }
  return nearest;
}

// Use the Teams OFFICIAL transcript AS the transcript: its per-speaker
// segmentation already splits overlapping/rapid turns correctly (audio
// diarisation merges them into one block). We only reconcile the speaker names
// to the stored participant short names; text/timestamps come straight from
// Teams. Prefer this over remapSpeakersFromTeams when Teams' text quality is
// acceptable (English meetings) — it fixes speaker splitting, not just labels.
export function reconcileTeamsSegments(
  teamsSegments: DiarizedTranscriptSegment[],
  participants: string[],
  offsetSeconds = 0
): DiarizedTranscriptSegment[] {
  // Teams timestamps run on the MEETING clock; the recording/video starts when
  // the bot joins (a bit later). Subtract that offset so segment times line up
  // with the video — otherwise the UI highlights the wrong line during playback.
  // Segments that end before the recording began (negative) are dropped.
  const out: DiarizedTranscriptSegment[] = [];
  for (const seg of teamsSegments) {
    const startTime = seg.startTime - offsetSeconds;
    const endTime = seg.endTime - offsetSeconds;
    if (endTime <= 0) continue;
    const speaker = reconcileSpeakerName(seg.speaker, participants);
    out.push({ ...seg, speaker, clusterId: speaker, startTime: Math.max(0, startTime), endTime });
  }
  return out;
}

// Overlay the Teams speaker names onto `segments`. Text/timestamps are kept;
// only `speaker` (and clusterId, so downstream grouping follows the new speaker)
// is overwritten. Returns the segments unchanged if there are no Teams spans.
export function remapSpeakersFromTeams(
  segments: DiarizedTranscriptSegment[],
  teamsSegments: Array<Pick<DiarizedTranscriptSegment, "speaker" | "startTime" | "endTime">>,
  participants: string[]
): DiarizedTranscriptSegment[] {
  const spans: SpeakerSpan[] = teamsSegments
    .filter((s) => typeof s.startTime === "number" && typeof s.endTime === "number" && s.speaker)
    .map((s) => ({ speaker: s.speaker, start: s.startTime, end: s.endTime }));
  if (spans.length === 0 || segments.length === 0) return segments;

  const offset = estimateClockOffset(segments.map((s) => s.startTime), spans);
  return segments.map((seg) => {
    const teamsSpeaker = bestOverlapSpeaker(seg.startTime, seg.endTime, spans, offset);
    if (!teamsSpeaker) return seg;
    const speaker = reconcileSpeakerName(teamsSpeaker, participants);
    return { ...seg, speaker, clusterId: speaker };
  });
}
