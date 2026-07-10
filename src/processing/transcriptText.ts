import { formatTimestamp } from "../utils/time";
import type { DiarizedTranscriptSegment } from "../types/meeting";

export function buildTranscriptText(segments: DiarizedTranscriptSegment[]): string {
  const lines: string[] = [];
  let previousKey = "";

  const ordered = [...segments].sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
  for (const segment of ordered) {
    const text = segment.text.replace(/\s+/g, " ").trim();
    if (!text) continue;

    const key = `${segment.startTime}:${segment.endTime}:${segment.speaker}:${text}`;
    if (key === previousKey) continue;
    previousKey = key;

    lines.push(`[${formatTimestamp(segment.startTime)} - ${formatTimestamp(segment.endTime)}] ${segment.speaker}: ${text}`);
  }

  return lines.join("\n");
}
