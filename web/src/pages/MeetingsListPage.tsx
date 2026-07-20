import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { JoinMeetingModal } from "../components/meetings/JoinMeetingModal";

type View = "list" | "grid";
const VIEW_STORAGE_KEY = "gvoice:meetings-view";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { Button } from "../components/ui/Button";
import { Avatar } from "../components/ui/Avatar";
import { EmptyState } from "../components/ui/EmptyState";
import { AnimatedCounter } from "../components/ui/AnimatedCounter";
import { Icon } from "../components/Icon";
import { getMeetingStats, listMeetings, type MeetingStats } from "../lib/api";
import type {
  BotPlatform,
  BotStatus,
  MeetingListItem,
  MeetingListResponse,
  SentimentLabel
} from "../lib/types";
import {
  formatDuration,
  formatRelative,
  platformLabel,
  platformTone,
  sentimentTone,
  statusTone,
  statusLabel,
  statusDotClass,
  isMeetingInProgress,
  isMeetingStale,
  isNegativeMeeting,
  isCriticalNegativeMeeting,
  byMostNegative
} from "../lib/format";

const platformOptions: Array<{ value: "" | BotPlatform; label: string }> = [
  { value: "", label: "All" },
  { value: "google_meet", label: "Meet" },
  { value: "microsoft_teams", label: "Teams" },
  { value: "zoom", label: "Zoom" }
];

const statusOptions: Array<{ value: "" | BotStatus; label: string }> = [
  { value: "", label: "Any status" },
  { value: "completed", label: "Completed" },
  { value: "processing", label: "Processing" },
  { value: "recording", label: "Recording" },
  { value: "failed", label: "Failed" }
];

export function MeetingsListPage() {
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState<"" | BotPlatform>("");
  const [status, setStatus] = useState<"" | BotStatus>("");
  // Page lives in the URL (?page=2) so it survives reloads, back/forward and
  // bookmarks. It's derived from the query string each render; setPage writes it
  // back. Page 1 is the default and is kept out of the URL to keep links clean.
  // Writes use { replace: true } so paging doesn't stack history entries — and
  // because search's onChange still calls setPage(1) on every keystroke. Search
  // and filters intentionally stay in-memory (not URL-synced) for now.
  const [searchParams, setSearchParams] = useSearchParams();
  // "Needs attention" mode — surface only the negative / bad meetings. Lives in
  // the URL (?flag=negative) so the dashboard can deep-link straight into it.
  const negativeOnly = searchParams.get("flag") === "negative";
  const setNegativeOnly = (on: boolean) => {
    const params = new URLSearchParams(searchParams);
    if (on) params.set("flag", "negative");
    else params.delete("flag");
    params.delete("page");
    setSearchParams(params, { replace: true });
  };
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const setPage = (next: number) => {
    const target = Math.max(1, next);
    if (target === page) return;
    const params = new URLSearchParams(searchParams);
    if (target <= 1) params.delete("page");
    else params.set("page", String(target));
    setSearchParams(params, { replace: true });
  };
  const [data, setData] = useState<MeetingListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 220);
    return () => clearTimeout(id);
  }, [search]);

  // Bumped after a new bot is created to re-trigger the fetch.
  const [refreshKey, setRefreshKey] = useState(0);
  const [joinOpen, setJoinOpen] = useState(false);
  const navigate = useNavigate();

  // Stats across ALL the user's meetings — independent of pagination/filters.
  // Refetched only when the user creates a new bot (refreshKey changes).
  const [stats, setStats] = useState<MeetingStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    getMeetingStats()
      .then((s) => !cancelled && setStats(s))
      .catch(() => {
        /* non-fatal — strip falls back to current-page values */
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listMeetings({
      // In "negative only" mode we filter client-side, so pull a larger window
      // (the API returns sentiment on each item) and show all matches at once
      // rather than server-paginating.
      page: negativeOnly ? 1 : page,
      pageSize: negativeOnly ? 100 : 20,
      platform: platform || undefined,
      status: status || undefined,
      search: debouncedSearch || undefined
    })
      .then((response) => !cancelled && setData(response))
      .catch((err: Error) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [page, platform, status, debouncedSearch, refreshKey, negativeOnly]);

  const items = data?.items ?? [];
  // What actually renders: in negative mode, keep only bad meetings, worst first.
  const displayItems = useMemo(
    () => (negativeOnly ? items.filter(isNegativeMeeting).sort(byMostNegative) : items),
    [items, negativeOnly]
  );
  const totalPages = useMemo(
    () => (data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1),
    [data]
  );
  const hasActiveFilters = !!search || !!platform || !!status || negativeOnly;

  // Card-vs-list preference, persisted so it survives navigation away & back.
  const [view, setView] = useState<View>(() => {
    if (typeof window === "undefined") return "list";
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return stored === "grid" || stored === "list" ? stored : "list";
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {}
  }, [view]);

  // Quick-stat strip uses global stats when available; falls back to
  // current-page aggregation while the stats request is in flight so the
  // strip never shows a flash of zeros.
  const pageStats = useMemo(() => deriveStripStats(items), [items]);
  const stripStats = stats ?? pageStats;
  const stripTotal = stats?.total ?? data?.total ?? items.length;

  return (
    <div className="max-w-[1280px] mx-auto px-6 lg:px-12 py-10 lg:py-12 page-enter">
      {/* Hero */}
      <header className="mb-8">
        <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-inkMute mb-2">Library</p>
            <h1 className="text-[36px] lg:text-[44px] font-semibold tracking-tightest text-ink leading-[1.05]">
              Meetings
            </h1>
            <p className="text-inkMute text-[14.5px] mt-2">
              {!data
                ? "Loading…"
                : negativeOnly
                ? `${displayItems.length} negative ${displayItems.length === 1 ? "meeting" : "meetings"} · needs attention`
                : `${data.total.toLocaleString()} total · ${data.items.length} on this page`}
            </p>
          </div>
          <Button
            variant="primary"
            size="md"
            icon={<Icon.Plus size={14} />}
            onClick={() => setJoinOpen(true)}
          >
            Join meeting
          </Button>
        </div>

        {/* Quick-stat strip — aggregated across ALL the user's meetings */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 stagger">
          <StatPill
            label="Total meetings"
            value={stripTotal}
            icon={<Icon.Meetings size={13} />}
            tone="neutral"
          />
          <StatPill
            label="With recording"
            value={stripStats.recorded}
            icon={<Icon.Play size={12} />}
            tone="positive"
          />
          <StatPill
            label="Positive"
            value={stripStats.positive}
            icon={<Icon.Trend size={13} />}
            tone="positive"
            extra={
              stripStats.positiveShare !== null
                ? `${stripStats.positiveShare}% share`
                : undefined
            }
          />
          <StatPill
            label="Action items"
            value={stripStats.actionItems}
            icon={<Icon.Bolt size={13} />}
            tone="warn"
            extra={
              stripStats.avgActions !== null
                ? `${stripStats.avgActions.toFixed(1)} avg`
                : undefined
            }
          />
        </div>
      </header>

      {/* Sticky filter bar */}
      <div className="sticky top-0 lg:top-2 z-10 mb-4">
        <div className="flex flex-wrap items-center gap-2 p-2 rounded-xl bg-overlay backdrop-blur-md border border-line shadow-sm">
          <div className="relative flex-1 min-w-[220px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-inkMute">
              <Icon.Search size={14} />
            </span>
            <input
              type="search"
              placeholder="Search transcripts, summaries, participants…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              className="w-full h-9 bg-surface border border-line rounded-lg pl-9 pr-3 text-[13px] placeholder:text-inkFaint focus-ring transition-colors hover:border-lineHi"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded hover:bg-surfaceHi flex items-center justify-center text-inkMute"
                aria-label="Clear search"
              >
                <Icon.Close size={12} />
              </button>
            )}
          </div>
          <Segmented
            value={platform}
            onChange={(v) => {
              setPlatform(v as "" | BotPlatform);
              setPage(1);
            }}
            options={platformOptions}
          />
          <Select
            value={status}
            onChange={(v) => {
              setStatus(v as "" | BotStatus);
              setPage(1);
            }}
            options={statusOptions}
          />
          <button
            type="button"
            onClick={() => setNegativeOnly(!negativeOnly)}
            aria-pressed={negativeOnly}
            title="Show only negative / needs-attention meetings"
            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[12.5px] font-medium transition-colors focus-ring shrink-0 ${
              negativeOnly
                ? "border-negative/50 bg-negative/10 text-negative"
                : "border-line bg-surface text-inkMute hover:text-ink"
            }`}
          >
            <Icon.AlertCircle size={13} />
            Negative
          </button>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Icon.Close size={12} />}
              onClick={() => {
                setSearch("");
                setPlatform("");
                setStatus("");
                setNegativeOnly(false);
                setPage(1);
              }}
            >
              Reset
            </Button>
          )}
          <ViewToggle value={view} onChange={setView} />
        </div>
      </div>

      {error && (
        <Card padded className="mb-4 border-negative/30 bg-negative/5">
          <p className="text-negative dark:text-negativeHi text-sm flex items-center gap-2">
            <Icon.AlertCircle size={14} /> Failed to load: {error}
          </p>
        </Card>
      )}

      {/* Loading state */}
      {loading && !data ? (
        view === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-56 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <Card className="overflow-hidden">
            <div className="p-2 space-y-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          </Card>
        )
      ) : displayItems.length === 0 ? (
        <Card className="overflow-hidden">
          <EmptyState
            icon={negativeOnly ? <Icon.CheckCircle size={18} /> : <Icon.Meetings size={18} />}
            title={negativeOnly ? "No negative meetings" : "No meetings match"}
            description={
              negativeOnly
                ? "Nothing needs attention — no meetings came out negative. 🎉"
                : hasActiveFilters
                ? "Try clearing the filters above."
                : "Once your bot captures a meeting, it'll show up here."
            }
            action={
              hasActiveFilters && (
                <Button
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setPlatform("");
                    setStatus("");
                  }}
                >
                  Reset filters
                </Button>
              )
            }
          />
        </Card>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayItems.map((item, index) => (
            <div
              key={item.sessionId}
              className="animate-fade-up"
              style={{ animationDelay: `${Math.min(index, 10) * 28}ms` }}
            >
              <MeetingCard item={item} />
            </div>
          ))}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden md:grid grid-cols-[110px_1fr_140px_120px_90px_90px] gap-3 px-5 py-2.5 text-[10.5px] uppercase tracking-widest text-inkMute border-b border-line bg-overlay-soft">
            <span>Platform</span>
            <span>Summary</span>
            <span>Speakers</span>
            <span>Sentiment</span>
            <span>Length</span>
            <span className="text-right">When</span>
          </div>
          <ul className="divide-y divide-line">
            {displayItems.map((item, index) => (
              <li
                key={item.sessionId}
                className="animate-fade-up"
                style={{ animationDelay: `${Math.min(index, 10) * 28}ms` }}
              >
                <MeetingRow item={item} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Pagination — hidden in negative mode (all matches shown at once) */}
      {!negativeOnly && data && data.total > 0 && totalPages > 1 && (
        <Pagination
          page={data.page}
          totalPages={totalPages}
          hasMore={data.hasMore}
          onPage={(p) => setPage(p)}
        />
      )}

      <JoinMeetingModal
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
        onCreated={(sessionId) => {
          setJoinOpen(false);
          setRefreshKey((v) => v + 1);
          navigate(`/meetings/${encodeURIComponent(sessionId)}`);
        }}
      />
    </div>
  );
}

function deriveStripStats(items: MeetingListItem[]) {
  const recorded = items.filter((m) => m.recordingUrl).length;
  const positive = items.filter(
    (m) => m.sentimentSummary?.overall.label === "positive"
  ).length;
  const totalSentiment = items.filter((m) => m.sentimentSummary?.overall).length;
  const positiveShare = totalSentiment
    ? Math.round((positive / totalSentiment) * 100)
    : null;
  const actionItems = items.reduce((sum, m) => sum + m.actionItems.length, 0);
  const avgActions = items.length ? actionItems / items.length : null;
  return { recorded, positive, positiveShare, actionItems, avgActions };
}

function StatPill({
  label,
  value,
  icon,
  tone,
  extra
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: "neutral" | "positive" | "warn" | "info";
  extra?: string;
}) {
  const dot: Record<typeof tone, string> = {
    neutral: "bg-neutral",
    positive: "bg-positive",
    warn: "bg-warn",
    info: "bg-info"
  };
  return (
    <Card padded className="lift">
      <div className="flex items-center justify-between text-[10.5px] uppercase tracking-widest text-inkMute">
        <span className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${dot[tone]}`} />
          {label}
        </span>
        <span className="text-inkFaint">{icon}</span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="text-[24px] font-semibold tabular-nums tracking-tight text-ink leading-none">
          <AnimatedCounter value={value} />
        </span>
        {extra && <span className="text-[11px] text-inkMute">{extra}</span>}
      </div>
    </Card>
  );
}

function MeetingRow({ item }: { item: MeetingListItem }) {
  const sentiment = item.sentimentSummary?.overall;
  const negative = isNegativeMeeting(item);
  const critical = isCriticalNegativeMeeting(item);
  const duration =
    item.startedAt && item.endedAt
      ? Math.round(
          (new Date(item.endedAt).getTime() - new Date(item.startedAt).getTime()) / 1000
        )
      : 0;

  return (
    <Link
      to={`/meetings/${encodeURIComponent(item.sessionId)}`}
      className={`grid md:grid-cols-[110px_1fr_140px_120px_90px_90px] gap-3 items-center px-5 py-3.5 hover:bg-surfaceHi transition-colors focus-ring group ${
        critical
          ? "border-l-2 border-negative bg-negative/[0.04]"
          : negative
          ? "border-l-2 border-negative/50"
          : ""
      }`}
    >
      <Badge dot tone={platformTone(item.platform)} className="justify-self-start">
        {platformLabel(item.platform)}
      </Badge>
      <div className="min-w-0 flex items-center gap-3">
        <MeetingThumbnail
          src={item.thumbnailUrl}
          alt={item.meetingName?.trim() || "Meeting thumbnail"}
        />
        <div className="min-w-0 flex-1">
        <p className="text-[14px] text-ink line-clamp-1 leading-snug">
          {item.meetingName?.trim() ||
            item.summary?.trim() || <span className="text-inkMute italic">Untitled meeting</span>}
        </p>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          {/* Dynamic session status (completed / recording / processing / failed …),
              coloured by tone; the dot pulses while the meeting is genuinely live.
              A non-terminal status with no activity for hours reads as "Stalled"
              (grey, no pulse) so a day-old queued job doesn't look ongoing. */}
          {(() => {
            const stale = isMeetingStale(item.status, item.updatedAt);
            const live = isMeetingInProgress(item.status) && !stale;
            return (
              <span
                className="inline-flex items-center gap-1 text-[10.5px] text-inkMute"
                title={stale ? "No activity for hours — likely never completed" : undefined}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    stale ? "bg-inkFaint" : statusDotClass(item.status)
                  }${live ? " animate-pulse" : ""}`}
                />
                {stale ? "Stalled" : statusLabel(item.status)}
              </span>
            );
          })()}
          {critical && (
            <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-negative">
              <Icon.AlertCircle size={10} />
              Needs attention
            </span>
          )}
          {item.actionItems.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[10.5px] text-inkMute">
              <Icon.Bolt size={10} className="text-warn" />
              {item.actionItems.length} action{item.actionItems.length === 1 ? "" : "s"}
            </span>
          )}
          {item.transcriptionProvider && (
            <span className="inline-flex items-center gap-1 text-[10.5px] text-inkMute capitalize" title="Transcription provider · detected language">
              <Icon.Mic size={10} className="text-inkFaint" />
              {item.transcriptionProvider}
              {item.meetingLanguage ? ` · ${item.meetingLanguage.toUpperCase()}` : ""}
            </span>
          )}
          <span className="inline-flex md:hidden items-center gap-1 text-[10.5px] text-inkMute">
            <Badge tone={statusTone(item.status)}>
              {item.status.replace(/_/g, " ")}
            </Badge>
          </span>
        </div>
        </div>
      </div>
      <div className="hidden md:flex items-center -space-x-1.5">
        {item.participants.slice(0, 4).map((p, i) => (
          <span
            key={i}
            className="ring-2 ring-surface rounded-full"
            style={{ zIndex: 10 - i }}
            title={p.name}
          >
            <Avatar name={p.name} size={22} />
          </span>
        ))}
        {item.participants.length > 4 && (
          <span className="text-[11px] text-inkMute pl-3">
            +{item.participants.length - 4}
          </span>
        )}
        {item.participants.length === 0 && (
          <span className="text-[11px] text-inkFaint">—</span>
        )}
      </div>
      <span className="hidden md:flex items-center gap-2">
        {sentiment ? (
          <>
            <SentimentDot label={sentiment.label} />
            <Badge tone={sentimentTone(sentiment.label)}>{sentiment.score.toFixed(2)}</Badge>
          </>
        ) : (
          <span className="text-[11px] text-inkFaint">—</span>
        )}
      </span>
      <span className="hidden md:inline text-[12px] font-mono tabular-nums text-inkSoft">
        {duration > 0 ? formatDuration(duration) : "—"}
      </span>
      <span className="hidden md:flex items-center justify-end gap-2 text-[12px] text-inkMute font-mono tabular-nums">
        {formatRelative(item.endedAt ?? item.startedAt ?? item.createdAt)}
        <Icon.ArrowRight
          size={12}
          className="text-inkFaint opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all"
        />
      </span>
    </Link>
  );
}

function MeetingThumbnail({ src, alt }: { src?: string; alt: string }) {
  return (
    <div className="hidden sm:flex shrink-0 w-[72px] aspect-video rounded-md overflow-hidden bg-surfaceHi border border-line items-center justify-center">
      {src ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className="w-full h-full object-cover"
        />
      ) : (
        <Icon.Video size={14} className="text-inkMute" />
      )}
    </div>
  );
}

// Mini ring badge: 8px diameter circle filled per sentiment label.
function SentimentDot({ label }: { label: SentimentLabel }) {
  const fill =
    label === "positive" ? "#10B981" : label === "negative" ? "#dc2626" : "#94a3b8";
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <circle cx="5" cy="5" r="4" fill="none" stroke={fill} strokeWidth="1.5" />
      <circle cx="5" cy="5" r="1.5" fill={fill} />
    </svg>
  );
}

function ViewToggle({
  value,
  onChange
}: {
  value: View;
  onChange: (next: View) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Result layout"
      className="inline-flex items-center p-0.5 rounded-lg border border-line bg-surface"
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === "list"}
        aria-label="List view"
        onClick={() => onChange("list")}
        className={`h-7 w-8 rounded-md flex items-center justify-center transition-colors ${
          value === "list" ? "bg-surfaceHi text-ink shadow-sm" : "text-inkMute hover:text-ink"
        }`}
      >
        <ListGlyph />
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === "grid"}
        aria-label="Card view"
        onClick={() => onChange("grid")}
        className={`h-7 w-8 rounded-md flex items-center justify-center transition-colors ${
          value === "grid" ? "bg-surfaceHi text-ink shadow-sm" : "text-inkMute hover:text-ink"
        }`}
      >
        <GridGlyph />
      </button>
    </div>
  );
}

function ListGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

function GridGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function MeetingCard({ item }: { item: MeetingListItem }) {
  const sentiment = item.sentimentSummary?.overall;
  const critical = isCriticalNegativeMeeting(item);
  const negative = isNegativeMeeting(item);
  const duration =
    item.startedAt && item.endedAt
      ? Math.round(
          (new Date(item.endedAt).getTime() - new Date(item.startedAt).getTime()) / 1000
        )
      : 0;
  const title =
    item.meetingName?.trim() ||
    item.summary?.trim()?.split(/[.!?]/)[0]?.trim() ||
    "Untitled meeting";
  const participants = item.participants ?? [];

  // Soft tinted gradient when there's no thumbnail, keyed off the platform so
  // it still feels intentional instead of an empty grey slab.
  const platformGradient: Record<MeetingListItem["platform"], string> = {
    google_meet:
      "linear-gradient(135deg, rgba(6,182,212,0.18), rgba(34,211,238,0.10) 60%, transparent)",
    microsoft_teams:
      "linear-gradient(135deg, rgba(37,99,235,0.20), rgba(99,102,241,0.10) 60%, transparent)",
    zoom:
      "linear-gradient(135deg, rgba(14,165,233,0.20), rgba(99,102,241,0.10) 60%, transparent)"
  };

  return (
    <Link
      to={`/meetings/${encodeURIComponent(item.sessionId)}`}
      className="group block focus-ring rounded-xl"
    >
      <Card
        className={`overflow-hidden lift h-full flex flex-col ${
          critical ? "ring-1 ring-negative/40" : negative ? "ring-1 ring-negative/20" : ""
        }`}
      >
        {/* Thumbnail */}
        <div
          className="relative aspect-video overflow-hidden"
          style={item.thumbnailUrl ? undefined : { background: platformGradient[item.platform] }}
        >
          {item.thumbnailUrl ? (
            <img
              src={item.thumbnailUrl}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            />
          ) : (
            <>
              <span
                className="absolute inset-0"
                style={{
                  backgroundImage:
                    "radial-gradient(circle at 30% 20%, rgba(255,255,255,0.10), transparent 55%), radial-gradient(circle at 70% 80%, rgba(255,255,255,0.06), transparent 55%)"
                }}
              />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="w-12 h-12 rounded-full bg-surface/70 backdrop-blur-sm border border-line flex items-center justify-center text-inkMute">
                  <Icon.Video size={18} />
                </span>
              </span>
            </>
          )}

          {/* Vignette so chips and the duration pill read clearly */}
          <span className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/45 to-transparent pointer-events-none" />
          <span className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/55 to-transparent pointer-events-none" />

          {/* Top chips */}
          <div className="absolute top-2.5 left-2.5 right-2.5 flex items-start justify-between gap-2">
            <Badge
              dot
              tone={platformTone(item.platform)}
              className="!bg-black/55 !text-white !border-white/15 backdrop-blur-md shadow-sm"
            >
              {platformLabel(item.platform)}
            </Badge>
            <Badge
              tone={statusTone(item.status)}
              className="!bg-black/55 !text-white !border-white/15 backdrop-blur-md shadow-sm"
            >
              {isMeetingStale(item.status, item.updatedAt) ? "Stalled" : statusLabel(item.status)}
            </Badge>
          </div>

          {/* Duration */}
          {duration > 0 && (
            <span className="absolute bottom-2.5 right-2.5 px-1.5 py-0.5 rounded text-[11px] font-mono tabular-nums bg-black/70 text-white backdrop-blur-md shadow-sm">
              {formatDuration(duration)}
            </span>
          )}

          {/* Sentiment dot on bottom-left if available */}
          {sentiment && (
            <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] font-medium bg-black/55 text-white backdrop-blur-md shadow-sm">
              <SentimentSwatch label={sentiment.label} />
              {sentiment.label} · {sentiment.score.toFixed(2)}
            </span>
          )}

          {/* Hover play affordance */}
          <span className="absolute inset-0 flex items-center justify-center opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 transition-all duration-300 pointer-events-none">
            <span className="w-14 h-14 rounded-full bg-white/95 text-bg flex items-center justify-center shadow-pop ring-1 ring-black/5">
              <span className="ml-0.5">
                <Icon.Play size={20} className="text-bg" />
              </span>
            </span>
          </span>
        </div>

        {/* Body */}
        <div className="p-4 flex-1 flex flex-col gap-3">
          <h3 className="text-[15px] font-semibold text-ink line-clamp-2 leading-snug tracking-tightest min-h-[2.6em] group-hover:text-brand-500 dark:group-hover:text-brand-400 transition-colors">
            {title}
          </h3>

          {/* Participants row */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center min-w-0 gap-2.5">
              <div className="flex items-center -space-x-2 shrink-0">
                {participants.slice(0, 4).map((p, i) => (
                  <span
                    key={i}
                    className="ring-2 ring-surface rounded-full"
                    style={{ zIndex: 10 - i }}
                    title={p.name}
                  >
                    <Avatar name={p.name} size={22} />
                  </span>
                ))}
                {participants.length === 0 && (
                  <span className="w-[22px] h-[22px] rounded-full border border-dashed border-line flex items-center justify-center text-inkFaint">
                    <Icon.Users size={11} />
                  </span>
                )}
              </div>
              <span className="text-[12px] text-inkMute truncate">
                {participants.length === 0
                  ? "No participants"
                  : participants.length === 1
                    ? participants[0]?.name
                    : participants.length === 2
                      ? `${participants[0]?.name}, ${participants[1]?.name}`
                      : `${participants[0]?.name} +${participants.length - 1}`}
              </span>
            </div>
          </div>

          {/* Transcription provider · detected language */}
          {item.transcriptionProvider && (
            <div className="flex items-center gap-1.5 text-[11px] text-inkMute" title="Transcription provider · detected language">
              <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-surfaceHi capitalize">{item.transcriptionProvider}</span>
              {item.meetingLanguage && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-surfaceHi uppercase">{item.meetingLanguage}</span>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="mt-auto flex items-center justify-between text-[11.5px] text-inkMute pt-3 border-t border-line">
            <span className="inline-flex items-center gap-1.5">
              {item.actionItems.length > 0 ? (
                <>
                  <span className="inline-flex w-5 h-5 rounded-md bg-warn/10 text-warn items-center justify-center">
                    <Icon.Bolt size={10} />
                  </span>
                  {item.actionItems.length} action
                  {item.actionItems.length === 1 ? "" : "s"}
                </>
              ) : (
                <span className="text-inkFaint">No actions</span>
              )}
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
              <Icon.Clock size={11} className="text-inkFaint" />
              {formatRelative(item.endedAt ?? item.startedAt ?? item.createdAt)}
            </span>
          </div>
        </div>
      </Card>
    </Link>
  );
}

function SentimentSwatch({ label }: { label: SentimentLabel }) {
  const fill =
    label === "positive" ? "#34D399" : label === "negative" ? "#f87171" : "#cbd5e1";
  return <span className="w-1.5 h-1.5 rounded-full" style={{ background: fill }} />;
}

function Segmented({
  value,
  onChange,
  options
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="inline-flex items-center p-0.5 rounded-lg border border-line bg-surface">
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value || "all"}
            type="button"
            onClick={() => onChange(option.value)}
            className={`h-7 px-3 rounded-md text-[12px] font-medium transition-colors ${
              active ? "bg-surfaceHi text-ink shadow-sm" : "text-inkMute hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Select({
  value,
  onChange,
  options
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="appearance-none h-9 bg-surface border border-line rounded-lg pl-3 pr-9 text-[13px] focus-ring transition-colors cursor-pointer hover:border-lineHi"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-surface text-ink">
            {option.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-inkMute">
        <Icon.ChevronDown size={12} />
      </span>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  hasMore,
  onPage
}: {
  page: number;
  totalPages: number;
  hasMore: boolean;
  onPage: (p: number) => void;
}) {
  // Build a compact set of page numbers around the current page.
  const pages: Array<number | "…"> = [];
  const add = (n: number | "…") => pages.push(n);
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i += 1) add(i);
  } else {
    add(1);
    if (page > 3) add("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i += 1) add(i);
    if (page < totalPages - 2) add("…");
    add(totalPages);
  }

  return (
    <div className="flex items-center justify-between mt-6 text-sm text-inkMute">
      <span>
        Page <span className="text-ink font-medium">{page}</span> of {totalPages}
      </span>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          icon={<Icon.ChevronLeft size={12} />}
          disabled={page <= 1}
          onClick={() => onPage(Math.max(1, page - 1))}
        >
          Prev
        </Button>
        <div className="hidden sm:flex items-center gap-1 mx-1">
          {pages.map((p, i) =>
            p === "…" ? (
              <span key={`g${i}`} className="px-1 text-inkMute select-none">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPage(p as number)}
                className={`min-w-[30px] h-8 px-2 rounded-md text-[12.5px] font-medium transition-colors focus-ring ${
                  p === page
                    ? "bg-brand-500 text-white shadow-sm"
                    : "text-inkSoft hover:bg-surfaceHi hover:text-ink"
                }`}
              >
                {p}
              </button>
            )
          )}
        </div>
        <Button
          size="sm"
          trailingIcon={<Icon.ChevronRight size={12} />}
          disabled={!hasMore}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
