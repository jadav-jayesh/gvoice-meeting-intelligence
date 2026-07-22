import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { AnimatedCounter } from "../components/ui/AnimatedCounter";
import { SentimentRing } from "../components/charts/SentimentRing";
import { Sparkline } from "../components/charts/Sparkline";
import { Icon } from "../components/Icon";
import { RangeFilter } from "../components/insights/RangeFilter";
import { ParticipationCard } from "../components/insights/ParticipationCard";
import { TopicsCard } from "../components/insights/TopicsCard";
import { listMeetings, type InsightRange } from "../lib/api";
import type { MeetingListItem, SentimentLabel } from "../lib/types";
import { formatRelative, platformLabel, platformTone } from "../lib/format";

export function InsightsPage() {
  const [items, setItems] = useState<MeetingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<InsightRange>("30d");

  useEffect(() => {
    let cancelled = false;
    listMeetings({ pageSize: 100 })
      .then((response) => !cancelled && setItems(response.items))
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const insights = useMemo(() => deriveInsights(items), [items]);

  return (
    <div className="page-shell py-10 lg:py-14 page-enter">
      <header className="mb-9">
        <p className="text-[11px] uppercase tracking-widest text-inkMute mb-2">AI</p>
        <h1 className="text-[34px] lg:text-[40px] font-semibold tracking-tightest text-ink leading-none">
          Insights
        </h1>
        <p className="text-inkMute text-[15px] mt-3 max-w-2xl leading-relaxed">
          Aggregated sentiment, top contributors, and the moments that defined recent meetings.
        </p>
      </header>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-72 w-full rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card padded>
          <EmptyState
            icon={<Icon.Sparkles size={18} />}
            title="Not enough data yet"
            description="Insights light up once your bot has captured a few meetings."
          />
        </Card>
      ) : (
        <div className="space-y-5 stagger">
          {/* Summary metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
            <SummaryStat
              label="Avg sentiment"
              value={insights.avgScore.toFixed(2)}
              accent={
                insights.avgScore > 0.1 ? "positive" : insights.avgScore < -0.1 ? "negative" : "neutral"
              }
              caption={
                insights.avgScore > 0.2
                  ? "Mostly positive"
                  : insights.avgScore < -0.2
                    ? "Mostly negative"
                    : "Mostly neutral"
              }
            />
            <SummaryStat
              label="Positive share"
              value={`${insights.positiveShare}%`}
              accent="positive"
              caption={`${insights.sentimentDist.positive} of ${insights.sentimentTotal} meetings`}
            />
            <SummaryStat
              label="Speakers tracked"
              value={insights.totalSpeakers}
              accent="neutral"
              caption={`${insights.activeSpeakers} active recently`}
            />
            <SummaryStat
              label="Avg participants"
              value={insights.avgParticipants.toFixed(1)}
              accent="info"
              caption="Per meeting"
            />
          </div>

          {/* Sentiment + trend */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card padded>
              <h3 className="text-[13.5px] font-semibold text-ink mb-1">Sentiment</h3>
              <p className="text-xs text-inkMute mb-5">
                Across {items.length} recent meetings
              </p>
              <div className="flex items-center justify-center">
                <SentimentRing
                  positive={insights.sentimentDist.positive}
                  neutral={insights.sentimentDist.neutral}
                  negative={insights.sentimentDist.negative}
                  size={150}
                />
              </div>
            </Card>

            <Card padded className="lg:col-span-2 surface-feature">
              <div className="flex items-start justify-between mb-1">
                <div>
                  <h3 className="text-[13.5px] font-semibold text-ink">Sentiment trend</h3>
                  <p className="text-xs text-inkMute">Average score over time</p>
                </div>
                <Badge
                  tone={
                    insights.avgScore > 0.1
                      ? "positive"
                      : insights.avgScore < -0.1
                        ? "negative"
                        : "neutral"
                  }
                >
                  Avg {insights.avgScore >= 0 ? "+" : ""}
                  {insights.avgScore.toFixed(2)}
                </Badge>
              </div>
              <Sparkline values={insights.sentimentTrend} width={620} height={140} />
            </Card>
          </div>

          {/* Participation & themes (server-backed, range-scoped) */}
          <div className="flex items-center justify-between pt-2">
            <h2 className="text-[13.5px] font-semibold text-ink tracking-tight">Participation &amp; themes</h2>
            <RangeFilter value={range} onChange={setRange} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ParticipationCard range={range} />
            <TopicsCard range={range} />
          </div>

          {/* Recent highlights */}
          <div className="grid grid-cols-1 gap-4">
            <Card padded>
              <h3 className="text-[13.5px] font-semibold text-ink mb-4">Recent highlights</h3>
              {insights.recentMoments.length === 0 ? (
                <p className="text-sm text-inkMute italic">No moments captured yet.</p>
              ) : (
                <ul className="space-y-2">
                  {insights.recentMoments.map((moment, index) => (
                    <li key={index}>
                      <Link
                        to={`/meetings/${encodeURIComponent(moment.sessionId)}`}
                        className="block focus-ring rounded-lg"
                      >
                        <div className="px-3 py-2.5 rounded-lg border border-line hover:border-lineHi hover:bg-surfaceHi transition-colors group">
                          <div className="flex items-center justify-between mb-1.5">
                            <Badge dot tone={platformTone(moment.platform)}>
                              {platformLabel(moment.platform)}
                            </Badge>
                            <span className="text-[11px] text-inkMute">
                              {formatRelative(moment.endedAt)}
                            </span>
                          </div>
                          <p className="text-[13.5px] text-ink line-clamp-2 italic">
                            “{moment.quote}”
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  accent,
  caption
}: {
  label: string;
  value: number | string;
  accent: "positive" | "negative" | "warn" | "info" | "neutral";
  caption: string;
}) {
  const dot: Record<typeof accent, string> = {
    positive: "bg-positive",
    negative: "bg-negative",
    warn: "bg-warn",
    info: "bg-info",
    neutral: "bg-neutral"
  };
  const valueClass: Record<typeof accent, string> = {
    positive: "text-positive dark:text-positiveHi",
    negative: "text-negative dark:text-negativeHi",
    warn: "text-warn",
    info: "text-info dark:text-info",
    neutral: "text-ink"
  };
  return (
    <Card padded interactive>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-inkMute">
        <span className={`w-1.5 h-1.5 rounded-full ${dot[accent]}`} />
        {label}
      </div>
      <div
        className={`mt-2 text-[28px] font-semibold tabular-nums tracking-tight leading-none ${valueClass[accent]}`}
      >
        {typeof value === "number" ? <AnimatedCounter value={value} /> : value}
      </div>
      <p className="mt-1.5 text-[12px] text-inkMute">{caption}</p>
    </Card>
  );
}

function deriveInsights(items: MeetingListItem[]) {
  const sentimentDist = { positive: 0, neutral: 0, negative: 0 };
  items.forEach((item) => {
    const label = item.sentimentSummary?.overall.label;
    if (label) sentimentDist[label] += 1;
  });
  const sentimentTotal =
    sentimentDist.positive + sentimentDist.neutral + sentimentDist.negative;
  const positiveShare = sentimentTotal
    ? Math.round((sentimentDist.positive / sentimentTotal) * 100)
    : 0;

  const scored = items
    .map((m) => m.sentimentSummary?.overall.score)
    .filter((v): v is number => typeof v === "number");
  const avgScore = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : 0;

  const buckets: Record<string, { sum: number; count: number; ts: number }> = {};
  items.forEach((item) => {
    const stamp = item.endedAt ?? item.startedAt ?? item.createdAt;
    const score = item.sentimentSummary?.overall.score;
    if (!stamp || typeof score !== "number") return;
    const date = new Date(stamp);
    const week = `${date.getFullYear()}-${String(getWeek(date)).padStart(2, "0")}`;
    if (!buckets[week]) buckets[week] = { sum: 0, count: 0, ts: date.getTime() };
    buckets[week].sum += score;
    buckets[week].count += 1;
  });
  const sentimentTrend = Object.values(buckets)
    .sort((a, b) => a.ts - b.ts)
    .map((bucket) => bucket.sum / bucket.count);
  while (sentimentTrend.length < 4) sentimentTrend.unshift(0);

  const allSpeakers = new Set<string>();
  const activeSet = new Set<string>();
  const speakerStats = new Map<
    string,
    { meetings: number; labels: Record<SentimentLabel, number> }
  >();
  const recentCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  items.forEach((item) => {
    const seen = new Set<string>();
    item.participants.forEach((p) => {
      if (!p.name) return;
      allSpeakers.add(p.name);
      seen.add(p.name);
    });
    const stamp = new Date(item.endedAt ?? item.startedAt ?? item.createdAt).getTime();
    seen.forEach((name) => {
      if (stamp >= recentCutoff) activeSet.add(name);
      const stat =
        speakerStats.get(name) ?? { meetings: 0, labels: { positive: 0, neutral: 0, negative: 0 } };
      stat.meetings += 1;
      const label = item.sentimentSummary?.overall.label;
      if (label) stat.labels[label] += 1;
      speakerStats.set(name, stat);
    });
  });
  const topSpeakers = Array.from(speakerStats.entries())
    .map(([name, stat]) => {
      const dominantLabel = (Object.entries(stat.labels) as Array<[SentimentLabel, number]>)
        .sort((a, b) => b[1] - a[1])[0];
      return {
        name,
        meetings: stat.meetings,
        dominantLabel: dominantLabel[1] > 0 ? dominantLabel[0] : undefined
      };
    })
    .sort((a, b) => b.meetings - a.meetings)
    .slice(0, 5);

  const avgParticipants = items.length
    ? items.reduce((sum, m) => sum + m.participants.length, 0) / items.length
    : 0;

  const recentMoments: Array<{
    sessionId: string;
    quote: string;
    platform: MeetingListItem["platform"];
    endedAt?: string;
  }> = [];
  items.slice(0, 4).forEach((item) => {
    if (item.summary?.trim()) {
      recentMoments.push({
        sessionId: item.sessionId,
        quote: item.summary.split(/[.!?]/)[0].trim().slice(0, 140) + "…",
        platform: item.platform,
        endedAt: item.endedAt ?? item.startedAt ?? item.createdAt
      });
    }
  });

  return {
    sentimentDist,
    sentimentTotal,
    positiveShare,
    avgScore,
    sentimentTrend,
    totalSpeakers: allSpeakers.size,
    activeSpeakers: activeSet.size,
    avgParticipants,
    topSpeakers,
    recentMoments
  };
}

function getWeek(date: Date) {
  const onejan = new Date(date.getFullYear(), 0, 1);
  return Math.ceil(((date.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
}
