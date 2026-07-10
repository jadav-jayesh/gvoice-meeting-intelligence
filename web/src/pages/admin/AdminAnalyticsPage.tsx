import { useEffect, useState, type ReactNode } from "react";
import { Card } from "../../components/ui/Card";
import { Skeleton } from "../../components/ui/Skeleton";
import { AnimatedCounter } from "../../components/ui/AnimatedCounter";
import { Sparkline } from "../../components/charts/Sparkline";
import { Icon } from "../../components/Icon";
import {
  adminGetAnalyticsSummary,
  adminGetAnalyticsTrends,
  type AdminAnalyticsSummary,
  type AdminTrendPoint
} from "../../lib/api";

interface Kpi {
  label: string;
  value: number;
  hint?: string;
  icon: (p: { size?: number; className?: string }) => ReactNode;
  accent: string; // hex
}

export function AdminAnalyticsPage() {
  const [summary, setSummary] = useState<AdminAnalyticsSummary | null>(null);
  const [trends, setTrends] = useState<AdminTrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([adminGetAnalyticsSummary(), adminGetAnalyticsTrends(30)])
      .then(([s, t]) => {
        if (cancelled) return;
        setSummary(s);
        setTrends(t.series);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load analytics"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const kpis: Kpi[] = summary
    ? [
        { label: "Total users", value: summary.userCount, icon: Icon.Users, accent: "#06B6D4" },
        { label: "Total meetings", value: summary.meetingCount, icon: Icon.Meetings, accent: "#8B5CF6" },
        { label: "Minutes transcribed", value: summary.totalMinutes, icon: Icon.Clock, accent: "#10B981" },
        {
          label: `Active · ${summary.activeWindowDays}d`,
          value: summary.activeUsers,
          hint: "Owns a meeting in window",
          icon: Icon.Bolt,
          accent: "#F59E0B"
        },
        {
          label: `Logged in · ${summary.activeWindowDays}d`,
          value: summary.activeByLogin,
          hint: "Since this shipped",
          icon: Icon.User,
          accent: "#3B82F6"
        }
      ]
    : [];

  return (
    <div className="max-w-[1280px] mx-auto px-6 lg:px-12 py-10 lg:py-14 page-enter">
      <header className="mb-8 lg:mb-10">
        <p className="text-[11px] uppercase tracking-widest text-inkMute mb-2">Admin</p>
        <h1 className="text-[34px] lg:text-[40px] font-semibold tracking-tightest text-ink leading-none">Analytics</h1>
        <p className="text-inkMute text-[15px] mt-3 max-w-2xl leading-relaxed">
          Platform-wide usage across all accounts.
        </p>
      </header>

      {error && (
        <div className="mb-6 rounded-lg border border-negative/20 bg-negative/5 px-4 py-3 text-[13px] text-negative">
          {error}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 lg:gap-4 mb-4 lg:mb-5">
        {loading || !summary
          ? Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} padded>
                <Skeleton className="h-7 w-7 rounded-lg mb-4" />
                <Skeleton className="h-3.5 w-20 mb-3" />
                <Skeleton className="h-7 w-14" />
              </Card>
            ))
          : kpis.map((k) => <KpiCard key={k.label} {...k} />)}
      </div>

      {/* Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-5">
        <TrendCard
          title="Signups"
          subtitle="New accounts per day"
          loading={loading}
          values={trends.map((t) => t.signups)}
          stroke="#06B6D4"
          fillId="spark-signups"
          fillFrom="rgba(6, 182, 212, 0.16)"
        />
        <TrendCard
          title="Meetings"
          subtitle="Recorded per day"
          loading={loading}
          values={trends.map((t) => t.meetings)}
          stroke="#8B5CF6"
          fillId="spark-meetings"
          fillFrom="rgba(139, 92, 246, 0.16)"
        />
      </div>
    </div>
  );
}

function KpiCard({ label, value, hint, icon: ItemIcon, accent }: Kpi) {
  return (
    <Card padded interactive className="flex flex-col">
      <span
        className="grid place-items-center w-9 h-9 rounded-xl mb-4"
        style={{ backgroundColor: `${accent}1A`, color: accent }}
        aria-hidden
      >
        <ItemIcon size={17} />
      </span>
      <p className="text-[12px] text-inkMute leading-tight">{label}</p>
      <p className="text-[30px] font-semibold tracking-tight text-ink leading-none mt-2">
        <AnimatedCounter value={value} />
      </p>
      {hint && <p className="text-[11px] text-inkFaint mt-auto pt-3">{hint}</p>}
    </Card>
  );
}

function TrendCard({
  title,
  subtitle,
  loading,
  values,
  stroke,
  fillId,
  fillFrom
}: {
  title: string;
  subtitle: string;
  loading: boolean;
  values: number[];
  stroke: string;
  fillId: string;
  fillFrom?: string;
}) {
  const total = values.reduce((n, v) => n + v, 0);
  const peak = values.length ? Math.max(...values) : 0;
  const avg = values.length ? total / values.length : 0;
  const hasData = values.some((v) => v > 0);

  return (
    <Card padded className="flex flex-col">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stroke }} aria-hidden />
          <div>
            <h2 className="text-[15px] font-semibold text-ink leading-none">{title}</h2>
            <p className="text-[12px] text-inkMute mt-1.5">{subtitle}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[26px] font-semibold tabular-nums text-ink leading-none">{total}</p>
          <p className="text-[10.5px] uppercase tracking-wider text-inkFaint mt-1.5">Last 30 days</p>
        </div>
      </div>

      <div className="mt-6 h-[88px] flex items-end">
        {loading ? (
          <Skeleton className="h-[72px] w-full" />
        ) : hasData ? (
          <Sparkline values={values} stroke={stroke} fillId={fillId} fillFrom={fillFrom} height={88} className="w-full" />
        ) : (
          <div className="w-full h-full grid place-items-center">
            <span className="text-[12.5px] text-inkFaint">No activity in this period</span>
          </div>
        )}
      </div>

      <div className="mt-5 pt-4 border-t border-line grid grid-cols-2 gap-4">
        <Stat label="Peak / day" value={peak} accent={stroke} />
        <Stat label="Avg / day" value={Math.round(avg * 10) / 10} accent={stroke} />
      </div>
    </Card>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-inkFaint">{label}</p>
      <p className="text-[18px] font-semibold tabular-nums text-ink mt-1" style={{ color: accent }}>
        {value}
      </p>
    </div>
  );
}
