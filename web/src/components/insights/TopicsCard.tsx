import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "../ui/Card";
import { Skeleton } from "../ui/Skeleton";
import { getTopics, type TopicsInsights, type InsightRange } from "../../lib/api";

// Recurring themes across meetings, from chapter titles (falls back to meeting
// names). Each chip links to a filtered meetings search. Read-only aggregate.
export function TopicsCard({ range }: { range: InsightRange }) {
  const [data, setData] = useState<TopicsInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getTopics(range)
      .then((d) => !cancelled && setData(d))
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range]);

  const max = data?.topics[0]?.count ?? 1;

  return (
    <Card padded>
      <h3 className="text-[13.5px] font-semibold text-ink mb-1">Top themes</h3>
      <p className="text-xs text-inkMute mb-4">What recent meetings were about</p>

      {loading ? (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-24 rounded-full" />
          ))}
        </div>
      ) : !data || data.topics.length === 0 ? (
        <p className="text-sm text-inkMute italic">No themes yet — captured once meetings have chapters.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {data.topics.map((t) => {
            const weight = 0.5 + 0.5 * (t.count / max); // 0.5–1 emphasis
            return (
              <button
                key={t.label}
                type="button"
                onClick={() => navigate(`/meetings?search=${encodeURIComponent(t.label)}`)}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[12.5px] text-inkSoft hover:border-lineHi hover:bg-surfaceHi transition-colors focus-ring"
                style={{ opacity: weight }}
                title={`${t.count} meeting${t.count === 1 ? "" : "s"}`}
              >
                <span className="truncate max-w-[180px]">{t.label}</span>
                <span className="text-[11px] text-inkMute tabular-nums">{t.count}</span>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
