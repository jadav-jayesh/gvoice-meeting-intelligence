import clsx from "clsx";
import { useEffect, useRef } from "react";
import type { DiarizedTranscriptSegment } from "../lib/types";
import { formatDuration, sentimentSwatch } from "../lib/format";
import { Avatar } from "./ui/Avatar";

interface Props {
  segments: DiarizedTranscriptSegment[];
  currentTime: number;
  onSeek: (time: number) => void;
  speakerFilter?: string | null;
  /** Optional className for the inner scroll container. */
  className?: string;
}

export function TranscriptList({
  segments,
  currentTime,
  onSeek,
  speakerFilter,
  className
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Per-row refs so we can scroll a specific element into the container's
  // visible area without bubbling up to ancestor scrollables.
  const rowRefs = useRef<Array<HTMLLIElement | null>>([]);
  const activeIndex = findActiveSegmentIndex(segments, currentTime);
  const lastActiveIndex = useRef<number | null>(null);
  const userScrollLockedAt = useRef<number>(0);

  // Pause auto-follow briefly when the user actively scrolls / wheels the
  // transcript, so we don't yank them back while they're reading ahead.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onUserActivity = () => {
      userScrollLockedAt.current = Date.now();
    };
    container.addEventListener("wheel", onUserActivity, { passive: true });
    container.addEventListener("touchstart", onUserActivity, { passive: true });
    return () => {
      container.removeEventListener("wheel", onUserActivity);
      container.removeEventListener("touchstart", onUserActivity);
    };
  }, []);

  // When the active segment changes, scroll only this container (NOT the
  // document) so video playback never tugs the main page scroll.
  useEffect(() => {
    if (activeIndex === lastActiveIndex.current) return;
    lastActiveIndex.current = activeIndex;
    if (activeIndex < 0) return;

    // Honour the user's recent manual scroll for 3 seconds.
    if (Date.now() - userScrollLockedAt.current < 3000) return;

    const container = containerRef.current;
    const row = rowRefs.current[activeIndex];
    if (!container || !row) return;

    // Centre the active row inside the container's visible area. offsetTop is
    // relative to the offset parent (the scroll container), so this never
    // moves the document.
    const target = row.offsetTop - container.clientHeight / 2 + row.offsetHeight / 2;
    const max = container.scrollHeight - container.clientHeight;
    const clamped = Math.max(0, Math.min(max, target));
    container.scrollTo({ top: clamped, behavior: "smooth" });
  }, [activeIndex]);

  if (segments.length === 0) {
    return (
      <div className={clsx("py-10 text-center text-inkMute text-sm", className)}>
        No transcript available for this meeting.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={clsx(
        "h-full overflow-y-auto px-3 py-2 overscroll-contain",
        className
      )}
      // overscroll-behavior: contain stops scroll chaining to the page on
      // touchpads / mobile when this scroller reaches its end.
    >
      <ol className="space-y-px">
        {segments.map((segment, index) => {
          if (speakerFilter && segment.speaker !== speakerFilter) return null;
          const isActive = index === activeIndex;
          return (
            <li
              key={index}
              ref={(el) => {
                rowRefs.current[index] = el;
              }}
            >
              <button
                type="button"
                onClick={() => onSeek(segment.startTime)}
                className={clsx(
                  "w-full text-left flex gap-3 rounded-lg px-3 py-2.5 transition-colors focus-ring",
                  isActive ? "bg-brand-500/10" : "hover:bg-surfaceHi"
                )}
              >
                <Avatar name={segment.speaker} size={26} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span
                      className={clsx(
                        "text-[11px] font-semibold uppercase tracking-wider truncate",
                        isActive
                          ? "text-brand-600 dark:text-brand-400"
                          : "text-inkSoft"
                      )}
                    >
                      {segment.speaker}
                    </span>
                    <span className="text-[10px] font-mono tabular-nums text-inkMute">
                      {formatDuration(segment.startTime)}
                    </span>
                    {segment.sentiment && (
                      <span
                        className={clsx(
                          "inline-block w-1.5 h-1.5 rounded-full",
                          sentimentSwatch(segment.sentiment.label)
                        )}
                        title={`${segment.sentiment.label} · ${segment.sentiment.score.toFixed(2)}`}
                      />
                    )}
                  </div>
                  <p className="text-[14px] text-ink leading-relaxed">{segment.text}</p>
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function findActiveSegmentIndex(
  segments: DiarizedTranscriptSegment[],
  currentTime: number
): number {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index].startTime <= currentTime) return index;
  }
  return -1;
}
