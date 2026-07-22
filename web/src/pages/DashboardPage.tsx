import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { Button } from "../components/ui/Button";
import { Avatar } from "../components/ui/Avatar";
import { AnimatedCounter } from "../components/ui/AnimatedCounter";
import { Sparkline } from "../components/charts/Sparkline";
import { SentimentRing } from "../components/charts/SentimentRing";
import { Heatmap } from "../components/charts/Heatmap";
import { Icon } from "../components/Icon";
import { ActionItemsCard } from "../components/dashboard/ActionItemsCard";
import { RangeFilter } from "../components/insights/RangeFilter";
import { listMeetings, type InsightRange } from "../lib/api";
import type { MeetingListItem } from "../lib/types";
import {
  formatRelative,
  platformLabel,
  platformTone,
  sentimentTone,
  statusTone,
  isNegativeMeeting,
  isCriticalNegativeMeeting,
  byMostNegative
} from "../lib/format";

export function DashboardPage() {
  const [items, setItems] = useState<MeetingListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<InsightRange>("30d");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listMeetings({ pageSize: 100 })
      .then((response) => {
        if (cancelled) return;
        setItems(response.items);
        setTotal(response.total);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => deriveStats(items, total), [items, total]);
  // Negative / "needs attention" meetings — worst first — surfaced prominently
  // so users can jump straight to the conversations that went badly.
  const negativeMeetings = useMemo(
    () => items.filter(isNegativeMeeting).sort(byMostNegative),
    [items]
  );
  const greeting = useMemo(getGreeting, []);

  const liveItems = items.filter((m) =>
    ["queued", "starting", "joining", "recording", "uploading", "processing"].includes(m.status)
  );

  return (
    <div className="page-shell py-10 lg:py-12 page-enter">
      {/* Hero */}
      <header className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 items-end mb-10">
        <div>
          <div className="inline-flex items-center gap-2 mb-3 px-2.5 py-1 rounded-full border border-line bg-surface-overlay backdrop-blur-sm text-[11px] uppercase tracking-widest text-inkMute">
            <span className="relative inline-flex w-1.5 h-1.5">
              <span className="absolute inset-0 rounded-full bg-positive" />
              <span className="absolute inset-0 rounded-full bg-positive animate-pulse-dot" />
            </span>
            Live · {formatToday()}
          </div>
          <h1 className="text-[36px] lg:text-[48px] font-semibold tracking-tightest leading-[1.04] text-ink">
            {greeting}
            <br />
            <span className="text-inkMute font-medium">Here's your workspace.</span>
          </h1>
        </div>
        <div className="flex gap-2">
          <Link to="/insights">
            <Button variant="secondary" size="md" icon={<Icon.Insights size={14} />}>
              Insights
            </Button>
          </Link>
          <Link to="/meetings">
            <Button variant="primary" size="md" trailingIcon={<Icon.ArrowRight size={14} />}>
              View meetings
            </Button>
          </Link>
        </div>
      </header>

      {/* Live now strip */}
      {liveItems.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3 text-[11px] uppercase tracking-widest text-inkMute">
            <span className="relative inline-flex w-1.5 h-1.5">
              <span className="absolute inset-0 rounded-full bg-negative" />
              <span className="absolute inset-0 rounded-full bg-negative animate-pulse-dot" />
            </span>
            Live now · {liveItems.length}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {liveItems.slice(0, 3).map((item) => (
              <Link
                key={item.sessionId}
                to={`/meetings/${encodeURIComponent(item.sessionId)}`}
                className="focus-ring rounded-xl"
              >
                <Card padded interactive className="lift">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge dot tone={platformTone(item.platform)}>
                      {platformLabel(item.platform)}
                    </Badge>
                    <Badge tone={statusTone(item.status)}>
                      {item.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <p className="text-[13.5px] text-ink line-clamp-2 leading-snug">
                    {item.summary?.trim() || (
                      <span className="text-inkMute italic">No summary yet</span>
                    )}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* KPI grid */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-8 stagger">
        <KpiCard
          label="Total meetings"
          value={total}
          loading={loading}
          accent="positive"
          spark={stats.activitySpark}
          delta={
            stats.activityTrend === 0
              ? "No change this week"
              : `${stats.activityTrend > 0 ? "+" : ""}${stats.activityTrend} vs last week`
          }
          deltaPositive={stats.activityTrend > 0}
        />
        <KpiCard
          label="Completed"
          value={stats.completed}
          loading={loading}
          delta={`${stats.completionRate}% completion`}
          accent="info"
        />
        <KpiCard
          label="In progress"
          value={stats.inProgress}
          loading={loading}
          delta={stats.inProgress > 0 ? "Recording or processing" : "All clear"}
          accent={stats.inProgress > 0 ? "warn" : "neutral"}
          pulse={stats.inProgress > 0}
        />
        <KpiCard
          label="Action items"
          value={stats.actionItemsTotal}
          loading={loading}
          delta={`${stats.avgActionItems.toFixed(1)} per meeting`}
          accent="brand"
        />
      </section>

      {/* Insights row: action items + sentiment + heatmap */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <SectionTitle>Insights</SectionTitle>
          <RangeFilter value={range} onChange={setRange} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 stagger">
        <ActionItemsCard range={range} />
        <Card padded className="lift overflow-hidden">
          <div className="flex items-start justify-between mb-1 gap-2">
            <SectionTitle>Sentiment</SectionTitle>
            {stats.sentimentTotal > 0 && (
              <Badge tone="neutral" className="font-mono shrink-0">
                n={stats.sentimentTotal}
              </Badge>
            )}
          </div>
          <p className="text-xs text-inkMute mb-6">Distribution across recent meetings</p>
          <div className="flex items-center justify-center w-full">
            {loading ? (
              <Skeleton className="w-32 h-32 rounded-full" />
            ) : (
              <SentimentRing
                positive={stats.sentimentDist.positive}
                neutral={stats.sentimentDist.neutral}
                negative={stats.sentimentDist.negative}
                size={130}
              />
            )}
          </div>
        </Card>

        <Card padded className="surface-feature lift">
          <div className="flex items-start justify-between mb-1">
            <SectionTitle>Activity heatmap</SectionTitle>
            <Badge
              tone={
                stats.activityTrend > 0
                  ? "positive"
                  : stats.activityTrend < 0
                    ? "warn"
                    : "neutral"
              }
            >
              {stats.activityTrend >= 0 ? "+" : ""}
              {stats.activityTrend} vs last week
            </Badge>
          </div>
          <p className="text-xs text-inkMute mb-5">
            {stats.activitySpark.reduce((a, b) => a + b, 0)} meetings over the last 26 weeks
          </p>
          {loading ? (
            <Skeleton className="h-32 w-full rounded-md" />
          ) : (
            <Heatmap values={stats.activitySpark} weeks={26} cellSize={11} gap={3} />
          )}
        </Card>
        </div>
      </section>

      {/* Needs attention — negative / bad meetings surfaced worst-first */}
      {!loading && negativeMeetings.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-negative/10 text-negative">
                <Icon.AlertCircle size={14} />
              </span>
              <SectionTitle>Needs attention</SectionTitle>
              <Badge tone="negative" className="font-mono">
                {negativeMeetings.length}
              </Badge>
            </div>
            <Link
              to="/meetings?flag=negative"
              className="text-[13px] text-inkSoft hover:text-ink inline-flex items-center gap-1 group transition-colors rounded focus-ring"
            >
              View all
              <Icon.ArrowRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </div>
          <Card className="overflow-hidden border-negative/20">
            <ul className="divide-y divide-line">
              {negativeMeetings.slice(0, 5).map((item, index) => {
                const overall = item.sentimentSummary?.overall;
                const critical = isCriticalNegativeMeeting(item);
                return (
                  <li
                    key={item.sessionId}
                    className="animate-fade-up"
                    style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
                  >
                    <Link
                      to={`/meetings/${encodeURIComponent(item.sessionId)}`}
                      className={`flex items-center gap-4 px-5 py-3.5 hover:bg-surfaceHi transition-colors focus-ring border-l-2 ${
                        critical ? "border-negative bg-negative/[0.03]" : "border-negative/50"
                      }`}
                    >
                      <Badge dot tone={platformTone(item.platform)}>
                        {platformLabel(item.platform)}
                      </Badge>
                      <p className="flex-1 text-[13.5px] text-ink line-clamp-1 min-w-0">
                        {item.meetingName?.trim() || item.summary?.trim() || (
                          <span className="text-inkMute italic">Untitled meeting</span>
                        )}
                      </p>
                      {critical && (
                        <span className="hidden sm:inline-flex items-center gap-1 text-[10.5px] font-medium text-negative shrink-0">
                          <Icon.AlertCircle size={10} /> Needs attention
                        </span>
                      )}
                      {overall && (
                        <Badge tone={sentimentTone(overall.label)} className="shrink-0">
                          {overall.score.toFixed(2)}
                        </Badge>
                      )}
                      <span className="hidden md:inline text-[12px] text-inkMute font-mono tabular-nums shrink-0">
                        {formatRelative(item.endedAt ?? item.startedAt ?? item.createdAt)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      )}

      {/* Recent meetings */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <SectionTitle>Recent meetings</SectionTitle>
          <Link
            to="/meetings"
            className="text-[13px] text-inkSoft hover:text-ink inline-flex items-center gap-1 group transition-colors rounded focus-ring"
          >
            View all
            <Icon.ArrowRight
              size={12}
              className="group-hover:translate-x-0.5 transition-transform"
            />
          </Link>
        </div>
        <Card className="overflow-hidden">
          {loading ? (
            <div className="p-2 space-y-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-inkMute">No meetings yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {items.slice(0, 5).map((item, index) => (
                <li
                  key={item.sessionId}
                  className="animate-fade-up"
                  style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
                >
                  <Link
                    to={`/meetings/${encodeURIComponent(item.sessionId)}`}
                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-surfaceHi transition-colors focus-ring"
                  >
                    <Badge dot tone={platformTone(item.platform)}>
                      {platformLabel(item.platform)}
                    </Badge>
                    <p className="flex-1 text-[13.5px] text-ink line-clamp-1 min-w-0">
                      {item.summary?.trim() || (
                        <span className="text-inkMute italic">No summary</span>
                      )}
                    </p>
                    <div className="hidden md:flex items-center -space-x-1.5">
                      {item.participants.slice(0, 3).map((p, i) => (
                        <span
                          key={i}
                          className="ring-2 ring-surface rounded-full"
                          style={{ zIndex: 10 - i }}
                        >
                          <Avatar name={p.name} size={22} />
                        </span>
                      ))}
                    </div>
                    {item.sentimentSummary?.overall && (
                      <Badge tone={sentimentTone(item.sentimentSummary.overall.label)}>
                        {item.sentimentSummary.overall.label}
                      </Badge>
                    )}
                    <Badge tone={statusTone(item.status)} className="hidden sm:inline-flex">
                      {item.status.replace(/_/g, " ")}
                    </Badge>
                    <span className="text-[11px] text-inkMute font-mono w-20 text-right shrink-0 tabular-nums">
                      {formatRelative(item.endedAt ?? item.startedAt ?? item.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

function deriveStats(items: MeetingListItem[], totalCount: number) {
  const completed = items.filter((m) => m.status === "completed").length;
  const inProgress = items.filter((m) =>
    ["queued", "starting", "joining", "recording", "uploading", "processing"].includes(m.status)
  ).length;
  const actionItemsTotal = items.reduce((sum, m) => sum + m.actionItems.length, 0);
  const avgActionItems = items.length ? actionItemsTotal / items.length : 0;

  const days = 7 * 26;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets = new Array(days).fill(0);
  items.forEach((item) => {
    const stamp = item.endedAt ?? item.startedAt ?? item.createdAt;
    if (!stamp) return;
    const day = new Date(stamp);
    day.setHours(0, 0, 0, 0);
    const idx = Math.floor((today.getTime() - day.getTime()) / (24 * 60 * 60 * 1000));
    if (idx >= 0 && idx < days) buckets[days - 1 - idx] += 1;
  });
  const activityTrend =
    buckets.slice(-7).reduce((a, b) => a + b, 0) -
    buckets.slice(-14, -7).reduce((a, b) => a + b, 0);

  const sentimentDist = { positive: 0, neutral: 0, negative: 0 };
  items.forEach((item) => {
    const label = item.sentimentSummary?.overall.label;
    if (label) sentimentDist[label] += 1;
  });
  const sentimentTotal =
    sentimentDist.positive + sentimentDist.neutral + sentimentDist.negative;

  const completionRate = items.length ? Math.round((completed / items.length) * 100) : 0;

  return {
    completed,
    inProgress,
    actionItemsTotal,
    avgActionItems,
    activitySpark: buckets,
    activityTrend,
    sentimentDist,
    sentimentTotal,
    completionRate,
    total: totalCount
  };
}


type Accent = "neutral" | "positive" | "negative" | "warn" | "info" | "brand";

function KpiCard({
  label,
  value,
  delta,
  deltaPositive,
  loading,
  accent = "neutral",
  spark,
  pulse
}: {
  label: string;
  value: number;
  delta?: string;
  deltaPositive?: boolean;
  loading?: boolean;
  accent?: Accent;
  spark?: number[];
  pulse?: boolean;
}) {
  const accentColors: Record<Accent, { stroke: string; from: string; to: string; dot: string }> = {
    positive: { stroke: "#10B981", from: "rgba(16,185,129,0.18)", to: "rgba(16,185,129,0)", dot: "bg-positive" },
    negative: { stroke: "#dc2626", from: "rgba(220,38,38,0.18)", to: "rgba(220,38,38,0)", dot: "bg-negative" },
    warn:     { stroke: "#d97706", from: "rgba(217,119,6,0.18)", to: "rgba(217,119,6,0)",  dot: "bg-warn" },
    info:     { stroke: "#22D3EE", from: "rgba(34,211,238,0.18)", to: "rgba(34,211,238,0)",  dot: "bg-info" },
    brand:    { stroke: "#0E7490", from: "rgba(14,116,144,0.18)", to: "rgba(14,116,144,0)", dot: "bg-info" },
    neutral:  { stroke: "#94a3b8", from: "rgba(148,163,184,0.14)", to: "rgba(148,163,184,0)", dot: "bg-neutral" }
  };
  const colors = accentColors[accent];

  return (
    <Card padded className="overflow-hidden lift">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-inkMute">
        {pulse ? (
          <span className="relative inline-flex w-1.5 h-1.5">
            <span className={`absolute inset-0 rounded-full ${colors.dot}`} />
            <span className={`absolute inset-0 rounded-full ${colors.dot} animate-pulse-dot`} />
          </span>
        ) : (
          <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
        )}
        {label}
      </div>
      <div className="mt-2 text-[30px] lg:text-[32px] font-semibold tabular-nums tracking-tight text-ink leading-none">
        {loading ? <Skeleton className="h-8 w-20" /> : <AnimatedCounter value={value} />}
      </div>
      {delta && !loading && (
        <p
          className={`mt-1.5 text-[12px] ${
            deltaPositive === true
              ? "text-positive dark:text-positiveHi"
              : deltaPositive === false
                ? "text-warn"
                : "text-inkMute"
          }`}
        >
          {delta}
        </p>
      )}
      {spark && spark.some((v) => v > 0) && !loading && (
        <div className="mt-3 -mb-1 -mx-1">
          <Sparkline
            values={spark}
            height={36}
            stroke={colors.stroke}
            fillFrom={colors.from}
            fillTo={colors.to}
            fillId={`spark-${label.replace(/\s+/g, "")}`}
          />
        </div>
      )}
    </Card>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[13.5px] font-semibold text-ink tracking-tight">{children}</h2>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Good night.";
  if (hour < 12) return "Good morning.";
  if (hour < 18) return "Good afternoon.";
  return "Good evening.";
}

function formatToday(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
}
