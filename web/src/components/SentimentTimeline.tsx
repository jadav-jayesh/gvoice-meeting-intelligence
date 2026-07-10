import clsx from "clsx";
import type { DiarizedTranscriptSegment, SentimentLabel } from "../lib/types";
import { sentimentSwatch } from "../lib/format";

interface Props {
  segments: DiarizedTranscriptSegment[];
  durationSeconds: number;
  currentTime: number;
  onSeek: (time: number) => void;
  height?: number;
}

export function SentimentTimeline({
  segments,
  durationSeconds,
  currentTime,
  onSeek,
  height = 12
}: Props) {
  if (durationSeconds <= 0 || segments.length === 0) {
    return <div className="rounded-md bg-surfaceHi" style={{ height }} />;
  }
  const playheadPct = Math.min(100, (currentTime / durationSeconds) * 100);
  return (
    <div
      className="relative rounded-md overflow-hidden bg-surfaceHi border border-line"
      style={{ height }}
    >
      {segments.map((segment, index) => {
        const left = (segment.startTime / durationSeconds) * 100;
        const width = Math.max(
          0.3,
          ((segment.endTime - segment.startTime) / durationSeconds) * 100
        );
        const label: SentimentLabel | undefined = segment.sentiment?.label;
        const intensity = Math.min(1, Math.abs(segment.sentiment?.score ?? 0));
        const opacity = 0.55 + 0.45 * intensity;
        return (
          <button
            key={index}
            type="button"
            onClick={() => onSeek(segment.startTime)}
            title={`${segment.speaker}: ${segment.text.slice(0, 80)}${
              segment.text.length > 80 ? "…" : ""
            }`}
            style={{ left: `${left}%`, width: `${width}%`, opacity }}
            className={clsx(
              "absolute top-0 bottom-0 transition-opacity hover:!opacity-100",
              sentimentSwatch(label)
            )}
          />
        );
      })}
      {/* Playhead */}
      <div
        className="absolute top-0 bottom-0 w-[2px] bg-ink pointer-events-none"
        style={{ left: `${playheadPct}%` }}
      />
    </div>
  );
}
