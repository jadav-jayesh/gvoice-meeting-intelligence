import { useEffect, useState } from "react";
import { Card } from "../ui/Card";
import { Avatar } from "../ui/Avatar";
import { Skeleton } from "../ui/Skeleton";
import { getParticipation, type ParticipationInsights, type InsightRange } from "../../lib/api";

// Talk-share by speaker (from diarized transcripts) — who actually drove the
// conversation, not just who attended. Read-only aggregate.
export function ParticipationCard({ range }: { range: InsightRange }) {
  const [data, setData] = useState<ParticipationInsights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getParticipation(range)
      .then((d) => !cancelled && setData(d))
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <Card padded>
      <h3 className="text-[13.5px] font-semibold text-ink mb-1">Talk share</h3>
      <p className="text-xs text-inkMute mb-4">Share of speaking time by participant</p>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-md" />
          ))}
        </div>
      ) : !data || data.speakers.length === 0 ? (
        <p className="text-sm text-inkMute italic">No speaker timing data yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {data.speakers.map((s) => (
            <li key={s.name} className="flex items-center gap-3">
              <Avatar name={s.name} size={26} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[13px] text-ink truncate">{s.name}</span>
                  <span className="text-[11.5px] text-inkMute tabular-nums shrink-0">
                    {Math.round(s.share * 100)}% · {formatDuration(s.talkSeconds)}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-surfaceHi overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400"
                    style={{ width: `${Math.max(2, Math.round(s.share * 100))}%` }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
