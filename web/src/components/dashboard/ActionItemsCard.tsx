import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Skeleton } from "../ui/Skeleton";
import { Icon } from "../Icon";
import { getActionItemInsights, type ActionItemInsights, type InsightRange } from "../../lib/api";

// Dashboard accountability widget: open vs done, overdue, and the owners with the
// most open items. Reads the /api/insights/action-items aggregate (MoM action
// items) — purely additive, no effect on meetings/bot.
export function ActionItemsCard({ range }: { range: InsightRange }) {
  const [data, setData] = useState<ActionItemInsights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getActionItemInsights(range)
      .then((d) => !cancelled && setData(d))
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <Card padded className="lift overflow-hidden">
      <div className="flex items-start justify-between mb-1 gap-2">
        <h2 className="text-[13.5px] font-semibold text-ink tracking-tight">Action items</h2>
        {data && data.overdueCount > 0 && (
          <Badge tone="negative" className="shrink-0">
            {data.overdueCount} overdue
          </Badge>
        )}
      </div>
      <p className="text-xs text-inkMute mb-5">Open work across recent meetings</p>

      {loading ? (
        <Skeleton className="h-40 w-full rounded-md" />
      ) : !data || data.total === 0 ? (
        <p className="py-10 text-center text-sm text-inkMute">No action items captured yet.</p>
      ) : (
        <>
          <div className="flex items-center gap-5 mb-5">
            <CompletionRing rate={data.completionRate} />
            <div className="grid grid-cols-2 gap-x-5 gap-y-2">
              <Stat label="Open" value={data.open} tone="text-ink" />
              <Stat label="Done" value={data.done} tone="text-positive dark:text-positiveHi" />
              <Stat label="Total" value={data.total} tone="text-ink" />
              <Stat
                label="Overdue"
                value={data.overdueCount}
                tone={data.overdueCount > 0 ? "text-negative dark:text-negativeHi" : "text-inkMute"}
              />
            </div>
          </div>

          {data.byOwner.length > 0 && (
            <div className="border-t border-line pt-3">
              <p className="text-[11px] uppercase tracking-widest text-inkMute mb-2">Top owners</p>
              <ul className="space-y-1.5">
                {data.byOwner.slice(0, 4).map((o) => (
                  <li key={o.owner} className="flex items-center gap-2 text-[12.5px]">
                    <span className="flex-1 truncate text-inkSoft">{o.owner}</span>
                    <span className="text-inkMute tabular-nums">
                      {o.open} open / {o.total}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.overdue.length > 0 && (
            <div className="border-t border-line pt-3 mt-3">
              <p className="text-[11px] uppercase tracking-widest text-inkMute mb-2 inline-flex items-center gap-1.5">
                <Icon.AlertCircle size={11} className="text-negative" /> Overdue
              </p>
              <ul className="space-y-1.5">
                {data.overdue.slice(0, 3).map((o, i) => (
                  <li key={i}>
                    <Link
                      to={`/meetings/${encodeURIComponent(o.sessionId)}`}
                      className="flex items-center gap-2 text-[12.5px] text-inkSoft hover:text-ink rounded focus-ring group"
                    >
                      <span className="flex-1 truncate group-hover:underline">{o.task}</span>
                      <span className="text-[11px] text-negative shrink-0">{o.due}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <div className={`text-[22px] font-semibold tabular-nums leading-none ${tone}`}>{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-widest text-inkMute">{label}</div>
    </div>
  );
}

function CompletionRing({ rate }: { rate: number }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - rate / 100);
  return (
    <div className="relative shrink-0" style={{ width: 72, height: 72 }}>
      <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90">
        <circle cx="36" cy="36" r={r} fill="none" stroke="var(--line)" strokeWidth="6" />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke="var(--ring)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 600ms cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="text-[15px] font-semibold tabular-nums text-ink">{rate}%</span>
      </div>
    </div>
  );
}
