import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Icon } from "../components/Icon";
import { platformLabel, platformTone, type BadgeTone } from "../lib/format";
import {
  getCalendarConnections,
  getUpcomingMeetings,
  startCalendarConnect,
  type CalendarConnectionsResponse,
  type CalendarProvider,
  type UpcomingMeeting,
  type UpcomingMeetingsResponse
} from "../lib/api";

type ViewMode = "month" | "week" | "agenda";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Brand logos served from /public (same assets the landing page uses).
const PLATFORM_LOGO: Record<string, string> = {
  google_meet: "/logo-meet.svg",
  microsoft_teams: "/logo-teams.svg",
  zoom: "/logo-zoom.svg"
};
const TONE_DOT: Record<BadgeTone, string> = {
  positive: "bg-positive",
  info: "bg-info",
  brand: "bg-brand-500",
  neutral: "bg-inkFaint",
  negative: "bg-negative",
  warn: "bg-warn"
};

export function CalendarPage() {
  const [connections, setConnections] = useState<CalendarConnectionsResponse | null>(null);
  const [data, setData] = useState<UpcomingMeetingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<CalendarProvider | null>(null);
  const [view, setView] = useState<ViewMode>("month");
  // A single cursor drives both month and week navigation; the visible range is
  // derived from it per view. `selected` is the day whose meetings the side
  // panel shows — it defaults to today and only moves when the user picks a day.
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [selectedKey, setSelectedKey] = useState(() => dayKey(new Date()));

  const monthDate = useMemo(() => startOfMonth(cursor), [cursor]);
  const gridDays = useMemo(() => buildMonthGrid(monthDate), [monthDate]);
  const weekDays = useMemo(() => buildWeek(cursor), [cursor]);

  // Range we fetch: the full visible span for month/week, a rolling window for
  // agenda. Recomputed whenever the view or cursor moves.
  const range = useMemo(() => {
    if (view === "agenda") {
      const now = startOfDay(new Date());
      return { from: now, to: endOfDay(addDays(now, 45)) };
    }
    const days = view === "week" ? weekDays : gridDays;
    return { from: startOfDay(days[0]), to: endOfDay(days[days.length - 1]) };
  }, [view, gridDays, weekDays]);

  // Load connections with retry. `connections` stays null until this resolves,
  // so the UI shows a skeleton (never a premature "not connected") while it's
  // in flight — and a transient first-load failure self-heals instead of
  // requiring a page reload.
  useEffect(() => {
    let active = true;
    let attempts = 0;
    async function load() {
      try {
        const result = await getCalendarConnections();
        if (active) setConnections(result);
      } catch {
        if (active && attempts++ < 4) window.setTimeout(load, 1500);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  // Load events for the visible range and keep them fresh automatically: poll
  // every 30s and whenever the tab regains focus, so a newly-scheduled meeting
  // appears on its own — no page reload, no refresh button. Polls are silent
  // (they never flash the skeleton); only range changes show the loading state.
  useEffect(() => {
    let active = true;
    let inFlight = false;
    const from = range.from.toISOString();
    const to = range.to.toISOString();

    async function fetchEvents(silent: boolean) {
      if (inFlight) return;
      inFlight = true;
      if (!silent) setLoading(true);
      try {
        const result = await getUpcomingMeetings({ from, to });
        if (active) setData(result);
      } catch {
        /* keep last-good data on transient errors */
      } finally {
        inFlight = false;
        if (active && !silent) setLoading(false);
      }
    }

    fetchEvents(false);
    const id = window.setInterval(() => fetchEvents(true), 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchEvents(true);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      active = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [range]);

  async function connect(provider: CalendarProvider) {
    setBusy(provider);
    try {
      const { url } = await startCalendarConnect(provider);
      window.location.href = url;
    } catch {
      setBusy(null);
    }
  }

  const hasConnection = (connections?.connections.length ?? 0) > 0;
  const eventsByDay = useMemo(() => groupEventsByDay(data?.meetings ?? []), [data?.meetings]);
  const agendaGroups = useMemo(() => buildAgenda(data?.meetings ?? []), [data?.meetings]);
  const selectedMeetings = eventsByDay.get(selectedKey) ?? [];
  // Providers that can still be added — configured on the server but not yet
  // connected — so the user can link a second calendar without hunting for it.
  const connectableProviders = (["google", "microsoft"] as CalendarProvider[]).filter(
    (p) => connections?.available[p] && !connections.connections.some((c) => c.provider === p)
  );

  const goToday = () => {
    setCursor(startOfDay(new Date()));
    setSelectedKey(dayKey(new Date()));
  };
  const step = (delta: number) =>
    setCursor((c) => (view === "week" ? addDays(c, 7 * delta) : addMonths(startOfMonth(c), delta)));

  return (
    <div className="page-shell py-8 lg:py-10 page-enter space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-widest text-inkFaint">Schedule</p>
          <h1 className="text-2xl font-semibold tracking-tighter2 text-ink">Calendar</h1>
          <p className="text-[13.5px] text-inkMute">Meetings gVoice will automatically join and record.</p>
        </div>
        {hasConnection && <Segmented value={view} onChange={setView} />}
      </header>

      {hasConnection && (
        <div className="flex flex-wrap items-center gap-2">
          {connections!.connections.map((c) => (
            <Badge key={c.provider} tone={c.status === "connected" ? "positive" : "warn"} dot>
              {c.provider === "google" ? "Google" : "Microsoft"}
              {c.accountEmail ? ` · ${c.accountEmail}` : ""}
            </Badge>
          ))}
          {connectableProviders.map((p) => (
            <button
              key={p}
              type="button"
              disabled={busy === p}
              onClick={() => connect(p)}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] text-inkMute hover:text-ink hover:border-ink/30 focus-ring transition-colors disabled:opacity-60"
            >
              <Icon.Plus size={12} />
              Connect {p === "google" ? "Google" : "Microsoft"}
            </button>
          ))}
          <Link to="/settings/calendars" className="text-[12px] text-inkMute hover:text-ink focus-ring rounded px-1 transition-colors">
            Manage
          </Link>
        </div>
      )}

      {data?.connectionErrors?.length ? (
        <div className="flex items-center gap-2 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2.5 text-[12.5px] text-warn">
          <Icon.AlertCircle size={14} />
          <span>
            We couldn't read one of your calendars.{" "}
            <Link to="/settings/calendars" className="underline underline-offset-2">
              Reconnect
            </Link>
            .
          </span>
        </div>
      ) : null}

      {connections === null ? (
        <div className="h-72 rounded-xl border border-line bg-surface animate-pulse" />
      ) : connections.connections.length === 0 ? (
        <NotConnected onConnect={connect} busy={busy} available={connections.available} />
      ) : view === "agenda" ? (
        <div className="mx-auto w-full max-w-2xl">
          <Agenda groups={agendaGroups} loading={loading} />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
          <div className="space-y-4">
            <CalendarToolbar
              label={
                view === "week"
                  ? weekRangeLabel(weekDays)
                  : monthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })
              }
              onPrev={() => step(-1)}
              onNext={() => step(1)}
              onToday={goToday}
            />
            {view === "week" ? (
              <WeekGrid
                weekDays={weekDays}
                eventsByDay={eventsByDay}
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
                loading={loading}
              />
            ) : (
              <MonthGrid
                gridDays={gridDays}
                monthDate={monthDate}
                eventsByDay={eventsByDay}
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
                loading={loading}
              />
            )}
          </div>
          <DayPanel dayKey={selectedKey} meetings={selectedMeetings} />
        </div>
      )}
    </div>
  );
}

// ── Segmented view switch ───────────────────────────────────────────────────

function Segmented({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line p-0.5 bg-surface">
      {(["month", "week", "agenda"] as ViewMode[]).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          className={`px-2.5 h-8 rounded-md text-[12.5px] capitalize transition-colors focus-ring ${
            value === mode ? "bg-surfaceHi text-ink font-medium" : "text-inkMute hover:text-ink"
          }`}
        >
          {mode}
        </button>
      ))}
    </div>
  );
}

function CalendarToolbar({
  label,
  onPrev,
  onNext,
  onToday
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-[15px] font-semibold text-ink tracking-tight">{label}</h2>
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" onClick={onToday}>
          Today
        </Button>
        <button
          type="button"
          onClick={onPrev}
          aria-label="Previous"
          className="grid place-items-center w-8 h-8 rounded-lg border border-line text-inkSoft hover:text-ink hover-soft focus-ring transition-colors"
        >
          <Icon.ChevronLeft size={16} />
        </button>
        <button
          type="button"
          onClick={onNext}
          aria-label="Next"
          className="grid place-items-center w-8 h-8 rounded-lg border border-line text-inkSoft hover:text-ink hover-soft focus-ring transition-colors"
        >
          <Icon.ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ── Month grid ──────────────────────────────────────────────────────────────

function MonthGrid({
  gridDays,
  monthDate,
  eventsByDay,
  selectedKey,
  onSelect,
  loading
}: {
  gridDays: Date[];
  monthDate: Date;
  eventsByDay: Map<string, UpcomingMeeting[]>;
  selectedKey: string;
  onSelect: (key: string) => void;
  loading: boolean;
}) {
  const todayKey = dayKey(new Date());
  return (
    <Card className={`overflow-hidden transition-opacity ${loading ? "opacity-60" : ""}`}>
      <div className="grid grid-cols-7 border-b border-line">
        {WEEKDAYS.map((day) => (
          <div key={day} className="px-2 py-2 text-center text-[11px] font-medium uppercase tracking-wider text-inkFaint">
            <span className="hidden sm:inline">{day}</span>
            <span className="sm:hidden">{day[0]}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {gridDays.map((day, index) => {
          const key = dayKey(day);
          const dayEvents = eventsByDay.get(key) ?? [];
          const inMonth = day.getMonth() === monthDate.getMonth();
          const isToday = key === todayKey;
          const isSelected = key === selectedKey;

          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(key);
                }
              }}
              aria-label={`${day.toDateString()}${dayEvents.length ? `, ${dayEvents.length} meeting${dayEvents.length > 1 ? "s" : ""}` : ""}`}
              aria-pressed={isSelected}
              className={`relative min-h-[92px] sm:min-h-[124px] p-1.5 border-b border-r border-line cursor-pointer outline-none transition-colors ${
                index % 7 === 0 ? "border-l" : ""
              } ${inMonth ? "bg-surface" : "bg-bg"} ${
                isSelected ? "ring-2 ring-inset ring-brand-500/60 bg-brand-500/[0.04]" : "hover:bg-surfaceHi focus-visible:bg-surfaceHi"
              }`}
            >
              <span
                className={`inline-grid place-items-center w-6 h-6 rounded-full text-[12px] tabular-nums ${
                  isToday ? "bg-brand-500 text-white font-semibold" : inMonth ? "text-ink" : "text-inkFaint"
                }`}
              >
                {day.getDate()}
              </span>
              <div className="mt-1 space-y-0.5">
                {dayEvents.slice(0, 4).map((meeting) => (
                  <DayChip key={`${meeting.source}-${meeting.id}`} meeting={meeting} />
                ))}
                {dayEvents.length > 4 && (
                  <span className="block px-1 text-[10.5px] text-inkMute">+{dayEvents.length - 4} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function DayChip({ meeting }: { meeting: UpcomingMeeting }) {
  const tone: BadgeTone = meeting.platform ? platformTone(meeting.platform) : "neutral";
  return (
    <span
      className={`flex items-center gap-1 px-1 py-px rounded text-[10.5px] truncate ${
        meeting.autoJoin ? "text-inkSoft" : "text-inkMute"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TONE_DOT[tone]}`} />
      <span className="truncate">
        <span className="hidden sm:inline tabular-nums text-inkFaint">{meeting.isAllDay ? "" : `${formatTime(meeting.startTime)} `}</span>
        {meeting.title}
      </span>
    </span>
  );
}

// ── Week grid ───────────────────────────────────────────────────────────────

function WeekGrid({
  weekDays,
  eventsByDay,
  selectedKey,
  onSelect,
  loading
}: {
  weekDays: Date[];
  eventsByDay: Map<string, UpcomingMeeting[]>;
  selectedKey: string;
  onSelect: (key: string) => void;
  loading: boolean;
}) {
  const todayKey = dayKey(new Date());
  return (
    <Card className={`overflow-hidden transition-opacity ${loading ? "opacity-60" : ""}`}>
      <div className="grid grid-cols-7">
        {weekDays.map((day, index) => {
          const key = dayKey(day);
          const dayEvents = eventsByDay.get(key) ?? [];
          const isToday = key === todayKey;
          const isSelected = key === selectedKey;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              aria-pressed={isSelected}
              className={`flex flex-col text-left min-h-[220px] border-b border-line ${index !== 0 ? "border-l" : ""} ${
                isSelected ? "bg-brand-500/[0.04]" : "hover:bg-surfaceHi"
              } transition-colors focus-ring`}
            >
              <div className={`px-2 py-2 border-b ${isSelected ? "border-brand-500/40" : "border-line"} text-center`}>
                <p className="text-[10.5px] uppercase tracking-wider text-inkFaint">{WEEKDAYS[day.getDay()]}</p>
                <span
                  className={`mt-0.5 inline-grid place-items-center w-6 h-6 rounded-full text-[12px] tabular-nums ${
                    isToday ? "bg-brand-500 text-white font-semibold" : "text-ink"
                  }`}
                >
                  {day.getDate()}
                </span>
              </div>
              <div className="flex-1 p-1.5 space-y-1">
                {dayEvents.length === 0 ? (
                  <span className="block px-1 pt-1 text-[10.5px] text-inkFaint">—</span>
                ) : (
                  dayEvents.map((meeting) => {
                    const tone: BadgeTone = meeting.platform ? platformTone(meeting.platform) : "neutral";
                    return (
                      <span
                        key={`${meeting.source}-${meeting.id}`}
                        className="block rounded-md border border-line bg-surface px-1.5 py-1 text-[10.5px] leading-tight"
                      >
                        <span className="flex items-center gap-1">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TONE_DOT[tone]}`} />
                          <span className="tabular-nums text-inkFaint">{meeting.isAllDay ? "All day" : formatTime(meeting.startTime)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-inkSoft">{meeting.title}</span>
                      </span>
                    );
                  })
                )}
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ── Selected-day side panel ─────────────────────────────────────────────────

function DayPanel({ dayKey: key, meetings }: { dayKey: string; meetings: UpcomingMeeting[] }) {
  const date = keyToDate(key);
  const isToday = key === dayKey(new Date());
  const sorted = [...meetings].sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));

  return (
    <Card className="lg:sticky lg:top-6 overflow-hidden">
      <div className="px-4 py-3.5 border-b border-line">
        <p className="text-[11px] uppercase tracking-widest text-inkFaint">{isToday ? "Today" : dayLabel(date)}</p>
        <h3 className="mt-0.5 text-[15px] font-semibold tracking-tight text-ink">
          {date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
        </h3>
        <p className="mt-0.5 text-[12px] text-inkMute">
          {sorted.length === 0 ? "No meetings" : `${sorted.length} meeting${sorted.length > 1 ? "s" : ""}`}
        </p>
      </div>
      <div className="p-3 max-h-[60vh] overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="py-10 text-center">
            <div className="mx-auto grid place-items-center w-10 h-10 rounded-xl border border-line bg-surfaceHi">
              <Icon.Calendar size={18} className="text-inkFaint" />
            </div>
            <p className="mt-3 text-[12.5px] text-inkMute">Nothing scheduled.</p>
            <p className="mt-0.5 text-[11.5px] text-inkFaint">Pick another day to see its meetings.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map((meeting) => (
              <PanelRow key={`${meeting.source}-${meeting.id}`} meeting={meeting} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function PanelRow({ meeting }: { meeting: UpcomingMeeting }) {
  const time = meeting.isAllDay ? "All day" : formatTime(meeting.startTime);
  const end = meeting.isAllDay ? "" : formatTime(meeting.endTime);
  return (
    <div className="rounded-lg border border-line bg-surface p-2.5 hover:border-brand-500/40 transition-colors">
      <div className="flex items-start gap-2.5">
        {meeting.platform && PLATFORM_LOGO[meeting.platform] ? (
          <img src={PLATFORM_LOGO[meeting.platform]} alt={platformLabel(meeting.platform)} className="mt-0.5 h-5 w-5 object-contain shrink-0" />
        ) : (
          <span className="mt-0.5 grid place-items-center h-5 w-5 rounded border border-line text-inkFaint shrink-0">
            <Icon.Calendar size={11} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink leading-snug">{meeting.title}</p>
          <p className="mt-0.5 text-[11.5px] tabular-nums text-inkMute">
            {time}
            {end && ` – ${end}`}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {meeting.platform ? (
              <Badge tone={platformTone(meeting.platform)}>{platformLabel(meeting.platform)}</Badge>
            ) : (
              <Badge tone="neutral">No link</Badge>
            )}
            {meeting.autoJoin && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-positive">
                <Icon.Check size={11} /> Auto-join
              </span>
            )}
          </div>
        </div>
        {meeting.joinUrl && (
          <a
            href={meeting.joinUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${meeting.title} link`}
            className="mt-0.5 shrink-0 grid place-items-center w-7 h-7 rounded-md border border-line text-inkSoft hover:text-ink hover:border-brand-500/40 hover-soft focus-ring transition-colors"
          >
            <Icon.Video size={13} />
          </a>
        )}
      </div>
    </div>
  );
}

// ── Agenda view ─────────────────────────────────────────────────────────────

function Agenda({ groups, loading }: { groups: DayGroup[]; loading: boolean }) {
  if (loading) return <AgendaSkeleton />;
  if (groups.length === 0) return <EmptyAgenda />;
  return (
    <div className="space-y-7">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <div className="sticky top-0 z-10 -mx-1 px-1 py-1.5 bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
            <h2 className="text-[12px] font-semibold uppercase tracking-wider text-inkSoft">{group.label}</h2>
          </div>
          <div className="mt-2 space-y-2">
            {group.meetings.map((meeting) => (
              <MeetingRow key={`${meeting.source}-${meeting.id}`} meeting={meeting} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function MeetingRow({ meeting }: { meeting: UpcomingMeeting }) {
  const time = meeting.isAllDay ? "All day" : formatTime(meeting.startTime);
  const end = meeting.isAllDay ? "" : formatTime(meeting.endTime);
  return (
    <Card padded className="flex items-stretch gap-4 hover:border-brand-500/40 transition-colors">
      <div className="w-[56px] shrink-0 flex flex-col items-center gap-1.5">
        {meeting.platform && PLATFORM_LOGO[meeting.platform] ? (
          <img src={PLATFORM_LOGO[meeting.platform]} alt={platformLabel(meeting.platform)} className="h-6 w-6 object-contain" />
        ) : (
          <span className="grid place-items-center h-6 w-6 rounded-md border border-line text-inkFaint">
            <Icon.Calendar size={13} />
          </span>
        )}
        <div className="text-center tabular-nums leading-tight">
          <p className="text-[12.5px] font-semibold text-ink">{time}</p>
          {end && <p className="text-[11px] text-inkFaint">{end}</p>}
        </div>
      </div>
      <div className={`w-px shrink-0 ${meeting.autoJoin ? "bg-brand-500/40" : "bg-line"}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-ink truncate">{meeting.title}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {meeting.platform ? <Badge tone={platformTone(meeting.platform)}>{platformLabel(meeting.platform)}</Badge> : <Badge tone="neutral">No link</Badge>}
          {meeting.autoJoin && (
            <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-positive">
              <Icon.Check size={12} /> Auto-join
            </span>
          )}
          {meeting.organizer && <span className="text-[11.5px] text-inkFaint truncate">{meeting.organizer}</span>}
        </div>
      </div>
      {meeting.joinUrl && (
        <a
          href={meeting.joinUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${meeting.title} link`}
          className="self-center shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-inkSoft hover:text-ink hover:border-brand-500/40 hover-soft focus-ring transition-colors"
        >
          <Icon.Video size={13} /> Join
        </a>
      )}
    </Card>
  );
}

function NotConnected({
  onConnect,
  busy,
  available
}: {
  onConnect: (p: CalendarProvider) => void;
  busy: CalendarProvider | null;
  available?: Record<CalendarProvider, boolean>;
}) {
  return (
    <Card padded className="text-center py-12">
      <div className="mx-auto grid place-items-center w-12 h-12 rounded-xl border border-line bg-surfaceHi">
        <Icon.Calendar size={22} className="text-inkSoft" />
      </div>
      <h2 className="mt-4 text-[16px] font-semibold text-ink">Connect a calendar</h2>
      <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-inkMute">
        Link Google or Microsoft and gVoice will automatically join and record your meetings — no need to paste links.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2.5">
        <Button variant="primary" size="md" loading={busy === "google"} disabled={available && !available.google} onClick={() => onConnect("google")}>
          Connect Google
        </Button>
        <Button variant="secondary" size="md" loading={busy === "microsoft"} disabled={available && !available.microsoft} onClick={() => onConnect("microsoft")}>
          Connect Microsoft
        </Button>
      </div>
    </Card>
  );
}

function EmptyAgenda() {
  return (
    <Card padded className="text-center py-12">
      <div className="mx-auto grid place-items-center w-12 h-12 rounded-xl border border-line bg-surfaceHi">
        <Icon.CheckCircle size={22} className="text-inkSoft" />
      </div>
      <h2 className="mt-4 text-[15px] font-semibold text-ink">No upcoming meetings</h2>
      <p className="mx-auto mt-1.5 max-w-xs text-[13px] text-inkMute">New meetings will appear here automatically.</p>
    </Card>
  );
}

function AgendaSkeleton() {
  return (
    <div className="space-y-7" aria-hidden>
      {[0, 1].map((g) => (
        <div key={g} className="space-y-2">
          <div className="h-3 w-24 rounded bg-surfaceHi animate-pulse" />
          {[0, 1, 2].map((r) => (
            <div key={r} className="flex items-center gap-4 rounded-xl border border-line bg-surface p-4">
              <div className="w-[64px] h-4 rounded bg-surfaceHi animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-2/3 rounded bg-surfaceHi animate-pulse" />
                <div className="h-3 w-1/3 rounded bg-surfaceHi animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Date helpers ────────────────────────────────────────────────────────────

interface DayGroup {
  key: string;
  label: string;
  meetings: UpcomingMeeting[];
}

function groupEventsByDay(meetings: UpcomingMeeting[]): Map<string, UpcomingMeeting[]> {
  const map = new Map<string, UpcomingMeeting[]>();
  for (const meeting of meetings) {
    const key = dayKey(new Date(meeting.startTime));
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(meeting);
  }
  return map;
}

function buildAgenda(meetings: UpcomingMeeting[]): DayGroup[] {
  const todayStart = startOfDay(new Date()).getTime();
  const groups = new Map<string, DayGroup>();
  for (const meeting of meetings) {
    const date = new Date(meeting.startTime);
    if (date.getTime() < todayStart) continue;
    const key = dayKey(date);
    if (!groups.has(key)) groups.set(key, { key, label: dayLabel(date), meetings: [] });
    groups.get(key)!.meetings.push(meeting);
  }
  return [...groups.values()];
}

function buildMonthGrid(monthDate: Date): Date[] {
  const first = startOfMonth(monthDate);
  const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
}

function buildWeek(date: Date): Date[] {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay());
  return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

function weekRangeLabel(week: Date[]): string {
  const a = week[0];
  const b = week[week.length - 1];
  const sameMonth = a.getMonth() === b.getMonth();
  const left = a.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const right = b.toLocaleDateString(undefined, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${left} – ${right}, ${b.getFullYear()}`;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}
function addDays(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta);
}
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}
function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
function keyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m, d);
}
function dayLabel(date: Date): string {
  const now = new Date();
  const today = dayKey(now);
  const tomorrow = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const key = dayKey(date);
  if (key === today) return "Today";
  if (key === tomorrow) return "Tomorrow";
  return date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
