import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { Avatar } from "../components/ui/Avatar";
import { Icon } from "../components/Icon";
import { SentimentTimeline } from "../components/SentimentTimeline";
import { TranscriptList } from "../components/TranscriptList";
import { ShareControl } from "../components/meetings/ShareControl";
import { deleteMeeting, getMeeting } from "../lib/api";
import type { BotStatus, Meeting, SentimentMoment } from "../lib/types";
import {
  buildFathomTranscript,
  formatDuration,
  formatRelative,
  isMeetingInProgress,
  platformLabel,
  platformTone,
  sentimentTone,
  statusTone
} from "../lib/format";
import { buildMomHtml } from "../lib/mom";

type Tab = "summary" | "actions" | "moments" | "speakers";

// How often the page re-fetches an in-flight meeting. Post-meeting processing
// typically runs for a few minutes, so a few seconds keeps the page feeling
// live without hammering the API.
const PROCESSING_POLL_MS = 4000;

// Each poll response re-signs the Azure SAS URLs, so the raw strings change on
// every tick even though the underlying blob hasn't. Treat URLs that differ
// only in their query string (the SAS signature) as the same media so the
// <video> element doesn't reload — and stop playback — mid-poll.
function sameMedia(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin && ua.pathname === ub.pathname;
  } catch {
    return false;
  }
}

function mergeMeetingUpdate(prev: Meeting | null, next: Meeting): Meeting {
  if (!prev) return next;
  return {
    ...next,
    recordingUrl: sameMedia(prev.recordingUrl, next.recordingUrl)
      ? prev.recordingUrl
      : next.recordingUrl,
    thumbnailUrl: sameMedia(prev.thumbnailUrl, next.thumbnailUrl)
      ? prev.thumbnailUrl
      : next.thumbnailUrl
  };
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function MeetingDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [speakerFilter, setSpeakerFilter] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Tracks whether we've already honored the ?t= deep-link for this session
  // so subsequent re-renders (e.g. when the user manually seeks) don't snap
  // back to the URL position.
  const initialSeekApplied = useRef(false);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getMeeting(sessionId)
      .then((response) => !cancelled && setMeeting(response))
      .catch((err: Error) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Live updates while the bot/pipeline is still working on this meeting:
  // poll the detail endpoint until the session reaches a terminal status
  // (completed / failed / transcript_unavailable). The worker persists each
  // stage as it finishes (upload → transcript → summary → MoM), so the page
  // fills in progressively without a manual refresh.
  const inProgress = meeting !== null && isMeetingInProgress(meeting.status);
  useEffect(() => {
    if (!sessionId || !inProgress) return;
    let cancelled = false;
    let inFlight = false;
    const tick = async () => {
      if (cancelled || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const next = await getMeeting(sessionId);
        if (!cancelled) setMeeting((prev) => mergeMeetingUpdate(prev, next));
      } catch {
        // Transient poll failures are fine — the next tick retries and the
        // page keeps showing the last data it had.
      } finally {
        inFlight = false;
      }
    };
    const intervalId = window.setInterval(tick, PROCESSING_POLL_MS);
    // Refresh immediately when the user returns to the tab instead of
    // waiting out the remainder of the interval.
    const onVisibilityChange = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [sessionId, inProgress]);

  const transcriptDuration = useMemo(() => {
    if (!meeting?.diarizedTranscript?.length) return 0;
    return Math.max(...meeting.diarizedTranscript.map((s) => s.endTime));
  }, [meeting]);
  const [videoDuration, setVideoDuration] = useState(0);
  const effectiveDuration = videoDuration || transcriptDuration;

  const handleSeek = (time: number) => {
    if (!videoRef.current) {
      setCurrentTime(time);
      return;
    }
    videoRef.current.currentTime = time;
    videoRef.current.play().catch(() => undefined);
  };

  // Deep-link seek: when the URL carries ?t=<seconds> (set by WATCH links in
  // exported transcripts), wait for the video metadata then jump there once.
  const deepLinkSeconds = useMemo(() => {
    const raw = searchParams.get("t");
    if (!raw) return null;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }, [searchParams]);

  useEffect(() => {
    initialSeekApplied.current = false;
  }, [sessionId, deepLinkSeconds]);

  const applyDeepLinkSeek = () => {
    if (initialSeekApplied.current || deepLinkSeconds === null || !videoRef.current) return;
    videoRef.current.currentTime = deepLinkSeconds;
    setCurrentTime(deepLinkSeconds);
    videoRef.current.play().catch(() => undefined);
    initialSeekApplied.current = true;
  };

  // Sticky compact header reveal
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 240);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  // Mirror the player card's rendered height onto the transcript panel so
  // the two columns visually balance. ResizeObserver tracks responsive
  // changes (window resize, aspect-ratio shifts).
  const playerWrapperRef = useRef<HTMLDivElement | null>(null);
  const [playerHeight, setPlayerHeight] = useState<number | null>(null);
  useEffect(() => {
    const node = playerWrapperRef.current;
    if (!node) return;
    // Skip on small screens — the right rail stacks under the player and the
    // height-match would create awkward gaps.
    const mql = window.matchMedia("(min-width: 1024px)");
    function sync() {
      if (!mql.matches) {
        setPlayerHeight(null);
        return;
      }
      setPlayerHeight(node!.getBoundingClientRect().height);
    }
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    mql.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      mql.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
    };
  }, [meeting]);

  async function handleDelete() {
    if (!sessionId) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteMeeting(sessionId);
      navigate("/meetings", { replace: true });
    } catch {
      setDeleteError("Couldn't delete this meeting. Please try again.");
      setDeleting(false);
    }
  }

  if (loading) return <DetailSkeleton />;
  if (error || !meeting) {
    return (
      <div className="max-w-[1280px] mx-auto px-6 lg:px-12 py-10">
        <Card padded className="border-negative/30 bg-negative/5">
          <p className="text-negative dark:text-negativeHi flex items-center gap-2">
            <Icon.AlertCircle size={14} /> Failed to load meeting: {error ?? "Not found"}
          </p>
          <Link
            to="/meetings"
            className="text-brand-500 dark:text-brand-400 hover:underline mt-3 inline-block text-sm"
          >
            ← Back to meetings
          </Link>
        </Card>
      </div>
    );
  }

  const overall = meeting.sentimentSummary?.overall;
  const speakers = uniqueSpeakers(meeting);
  const title =
    meeting.meetingName?.trim() ||
    (meeting.summary?.trim() || meeting.sessionId).split(/[.!?]/)[0].trim();

  return (
    <div className="max-w-[1280px] mx-auto px-6 lg:px-12 py-8 lg:py-10 page-enter">
      <CompactHeader
        meeting={meeting}
        visible={scrolled}
        currentTime={currentTime}
        duration={effectiveDuration}
      />

      <Link
        to="/meetings"
        className="text-[12px] text-inkMute hover:text-ink inline-flex items-center gap-1 mb-6 group transition-colors rounded focus-ring"
      >
        <Icon.ChevronLeft size={12} className="group-hover:-translate-x-0.5 transition-transform" />
        Meetings
      </Link>

      {/* Header */}
      <header className="mb-7">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Badge dot tone={platformTone(meeting.platform)}>
            {platformLabel(meeting.platform)}
          </Badge>
          <Badge tone={statusTone(meeting.status)}>{meeting.status.replace(/_/g, " ")}</Badge>
          {overall && (
            <Badge tone={sentimentTone(overall.label)}>
              {overall.label} · {overall.score.toFixed(2)}
            </Badge>
          )}
        </div>
        <h1 className="text-[28px] lg:text-[34px] font-semibold tracking-tightest text-ink leading-tight">
          {title.length > 140 ? title.slice(0, 140).trim() + "…" : title}
        </h1>
        <div className="mt-3 flex items-center flex-wrap gap-x-4 gap-y-2 text-[12.5px] text-inkMute">
          <span className="inline-flex items-center gap-1.5">
            <Icon.Calendar size={12} />
            {formatRelative(meeting.endedAt ?? meeting.startedAt ?? meeting.createdAt)}
          </span>
          {effectiveDuration > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <Icon.Clock size={12} />
              <span className="font-mono tabular-nums">{formatDuration(effectiveDuration)}</span>
            </span>
          )}
          {meeting.participants.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <Icon.Users size={12} />
              {meeting.participants.length} participant
              {meeting.participants.length === 1 ? "" : "s"}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            {/* Download MOM / video stay hidden until the pipeline fully
                completes — mid-processing the MoM doesn't exist yet and the
                recording may still be uploading. While the session is in
                flight a live "processing" chip sits in their place. */}
            {meeting.status === "completed" ? (
              <>
                <DownloadMomButton meeting={meeting} title={title} />
                {meeting.recordingUrl && (
                  <DownloadVideoButton meeting={meeting} title={title} />
                )}
              </>
            ) : (
              inProgress && (
                <span className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg border border-dashed border-line bg-surface text-[12.5px] text-inkMute shrink-0">
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-brand-500/30 border-t-brand-500 animate-spin" />
                  Processing — downloads unlock when complete
                </span>
              )
            )}
            <ShareControl
              sessionId={meeting.sessionId}
              initialEnabled={meeting.shareEnabled}
              initialToken={meeting.shareToken}
            />
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete meeting"
              title="Delete meeting"
              className="inline-flex items-center justify-center h-9 w-9 shrink-0 rounded-lg border border-line bg-surface text-inkMute transition-colors hover:border-negative/40 hover:text-negative focus-ring"
            >
              <TrashIcon />
            </button>
          </span>
        </div>
      </header>

      {confirmDelete &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-scrim p-4"
          onClick={() => !deleting && setConfirmDelete(false)}
        >
          <Card
            padded
            className="w-full max-w-md border-negative/30"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-negative/10 text-negative">
                <Icon.AlertCircle size={18} />
              </span>
              <div className="min-w-0">
                <h2 className="text-[16px] font-semibold text-ink">Delete this meeting?</h2>
                <p className="mt-1 text-[13px] text-inkMute">
                  This removes the meeting from your account. If no one else has access, the recording,
                  transcript and report are permanently deleted. This can’t be undone.
                </p>
              </div>
            </div>

            {deleteError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-lg border border-negative/30 bg-negative/5 px-3 py-2.5 text-[12.5px] text-negative"
              >
                <Icon.AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{deleteError}</span>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="h-9 px-4 rounded-lg border border-line bg-surface text-[13px] font-medium text-ink transition-colors hover:bg-line/40 focus-ring disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-negative text-white text-[13px] font-medium transition-colors hover:bg-negativeHi focus-ring disabled:opacity-60"
              >
                {deleting && (
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                )}
                Delete meeting
              </button>
            </div>
          </Card>
          </div>,
          document.body
        )}

      {inProgress && <ProcessingPanel meeting={meeting} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main */}
        <div className="lg:col-span-2 space-y-5">
          <div ref={playerWrapperRef}>
            <PlayerCard
              meeting={meeting}
              currentTime={currentTime}
              videoRef={videoRef}
              onLoadedMetadata={(e) => {
                setVideoDuration(e.currentTarget.duration || 0);
                applyDeepLinkSeek();
              }}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
              onSeeked={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
              effectiveDuration={effectiveDuration}
              onSeek={handleSeek}
            />
          </div>

          <Card className="overflow-hidden">
            <TabBar tab={tab} onChange={setTab} meeting={meeting} />
            <div className="p-5 lg:p-6">
              {tab === "summary" && <SummaryTab meeting={meeting} onSeek={handleSeek} />}
              {tab === "actions" && <ActionsTab meeting={meeting} />}
              {tab === "moments" && <MomentsTab meeting={meeting} onSeek={handleSeek} />}
              {tab === "speakers" && (
                <SpeakersTab
                  meeting={meeting}
                  onFilter={(speaker) => {
                    setSpeakerFilter(speaker);
                  }}
                  activeSpeaker={speakerFilter}
                />
              )}
            </div>
          </Card>
        </div>

        {/* Right rail */}
        <aside className="space-y-4">
          {/* Transcript — height matches the player card; internal scrolling
              never tugs the document. */}
          <Card
            className="overflow-hidden flex flex-col"
            style={
              playerHeight !== null
                ? { height: playerHeight, minHeight: 360 }
                : { minHeight: 480 }
            }
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-line shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-5 rounded-full bg-brand-500" />
                <h2 className="text-[13.5px] font-semibold text-ink">Transcript</h2>
              </div>
              <div className="flex items-center gap-2">
                {/* Segmented Copy + Download — visually one transcript-action
                 * unit, keeps the download icon from "sticking" to the count. */}
                <div className="inline-flex items-stretch rounded-md border border-line bg-surface overflow-hidden">
                  <CopyTranscriptButton meeting={meeting} />
                  <span aria-hidden className="w-px bg-line self-stretch" />
                  <DownloadTranscriptButton meeting={meeting} title={title} />
                </div>
                {speakers.length > 1 && (
                  <div className="relative">
                    <select
                      value={speakerFilter ?? ""}
                      onChange={(event) =>
                        setSpeakerFilter(event.target.value || null)
                      }
                      className="appearance-none bg-surface border border-line rounded-md pl-2.5 pr-7 h-7 text-[12px] focus-ring transition-colors hover:border-lineHi cursor-pointer text-ink"
                    >
                      <option value="">All speakers</option>
                      {speakers.map((speaker) => (
                        <option key={speaker} value={speaker}>
                          {speaker}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-inkMute">
                      <Icon.ChevronDown size={10} />
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <TranscriptList
                segments={meeting.diarizedTranscript}
                currentTime={currentTime}
                onSeek={handleSeek}
                speakerFilter={speakerFilter}
              />
            </div>
          </Card>

          {meeting.participants.length > 0 && (
            <Card padded>
              <SectionTitle>Participants · {meeting.participants.length}</SectionTitle>
              <ul className="mt-4 space-y-2.5">
                {meeting.participants.map((p, i) => (
                  <li key={i} className="flex items-center gap-2.5 text-[13.5px]">
                    <Avatar name={p.name} size={26} />
                    <span className="text-ink">{p.name}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

        </aside>
      </div>
    </div>
  );
}

function CompactHeader({
  meeting,
  visible,
  currentTime,
  duration
}: {
  meeting: Meeting;
  visible: boolean;
  currentTime: number;
  duration: number;
}) {
  return (
    <div
      className={`fixed top-0 lg:left-[var(--sidebar-w)] right-0 z-20 transition-all duration-300 ease-spring ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2 pointer-events-none"
      }`}
    >
      <div className="bg-overlay backdrop-blur-md border-b border-line shadow-sm">
        <div className="max-w-[1280px] mx-auto px-6 lg:px-12 h-12 flex items-center gap-3">
          <Link
            to="/meetings"
            className="w-7 h-7 rounded-md flex items-center justify-center text-inkMute hover:text-ink hover:bg-surfaceHi transition-colors"
            aria-label="Back"
          >
            <Icon.ChevronLeft size={13} />
          </Link>
          <Badge dot tone={platformTone(meeting.platform)}>
            {platformLabel(meeting.platform)}
          </Badge>
          <span className="text-[12.5px] text-ink truncate flex-1">
            {meeting.meetingName?.trim() ||
              meeting.summary?.slice(0, 80) ||
              meeting.sessionId}
          </span>
          {duration > 0 && (
            <span className="text-[11px] font-mono text-inkMute tabular-nums">
              {formatDuration(currentTime)} / {formatDuration(duration)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

type ProcessingStageState = "done" | "active" | "pending";

interface ProcessingStage {
  key: string;
  label: string;
  state: ProcessingStageState;
}

// Derives the post-meeting pipeline checklist from which fields the worker
// has persisted so far — each stage lights up live as its data lands in the
// DB and the next poll picks it up.
function deriveProcessingStages(meeting: Meeting): ProcessingStage[] {
  const pastUpload =
    meeting.status === "processing" ||
    meeting.status === "awaiting_transcript" ||
    meeting.status === "transcript_ready";
  // Teams Graph-only sessions never store a recording, so moving past the
  // upload status counts as done even without a recordingUrl.
  const uploadDone = Boolean(meeting.recordingUrl) || pastUpload;
  const transcriptDone =
    meeting.diarizedTranscript.length > 0 || Boolean(meeting.transcriptText?.trim());
  const summaryDone = Boolean(meeting.summary?.trim());
  const momDone = Boolean(meeting.momReport);

  const stages = [
    { key: "upload", label: "Upload recording", done: uploadDone },
    { key: "transcript", label: "Transcribe & identify speakers", done: transcriptDone },
    { key: "summary", label: "Summarize & extract actions", done: summaryDone },
    { key: "mom", label: "Build MoM report", done: momDone }
  ];

  // The first not-done stage is the active one — but only once the meeting
  // itself is over; while the bot is still joining/recording, every
  // post-meeting stage is just pending.
  const postMeeting = pastUpload || meeting.status === "uploading";
  let activeAssigned = false;
  return stages.map((stage) => {
    if (stage.done) return { ...stage, state: "done" as const };
    if (postMeeting && !activeAssigned) {
      activeAssigned = true;
      return { ...stage, state: "active" as const };
    }
    return { ...stage, state: "pending" as const };
  });
}

function processingHeadline(status: BotStatus): string {
  switch (status) {
    case "queued":
      return "Queued — waiting for a recorder";
    case "starting":
      return "Starting the meeting bot";
    case "joining":
      return "Joining the meeting";
    case "recording":
      return "Recording in progress";
    case "awaiting_transcript":
      return "Waiting for the Teams transcript";
    default:
      return "Post-meeting processing";
  }
}

function ProcessingPanel({ meeting }: { meeting: Meeting }) {
  const stages = deriveProcessingStages(meeting);
  const latest = meeting.meetingLogs?.[meeting.meetingLogs.length - 1];

  return (
    <Card padded className="mb-6 border-brand-500/30 bg-brand-500/5">
      <div className="flex items-start gap-3.5">
        <span className="mt-0.5 w-8 h-8 shrink-0 rounded-lg bg-brand-500/10 flex items-center justify-center">
          <span className="w-4 h-4 rounded-full border-2 border-brand-500/30 border-t-brand-500 animate-spin" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-[14px] font-semibold text-ink">
              {processingHeadline(meeting.status)}
            </h2>
            <span className="text-[11px] text-inkMute">
              This page updates automatically.
            </span>
          </div>
          {latest?.message && (
            <p className="mt-1 text-[12px] text-inkMute truncate" title={latest.message}>
              {latest.message}
            </p>
          )}
          <ol className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            {stages.map((stage) => (
              <li key={stage.key} className="flex items-center gap-1.5 text-[12px]">
                {stage.state === "done" ? (
                  <span className="w-4 h-4 rounded-full bg-positive/15 text-positive dark:text-positiveHi flex items-center justify-center">
                    <Icon.Check size={10} />
                  </span>
                ) : stage.state === "active" ? (
                  <span className="w-4 h-4 flex items-center justify-center">
                    <span className="w-3 h-3 rounded-full border-2 border-brand-500/30 border-t-brand-500 animate-spin" />
                  </span>
                ) : (
                  <span className="w-4 h-4 flex items-center justify-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-inkFaint" />
                  </span>
                )}
                <span className={stage.state === "pending" ? "text-inkMute" : "text-ink"}>
                  {stage.label}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Card>
  );
}

function PlayerCard({
  meeting,
  currentTime,
  videoRef,
  onLoadedMetadata,
  onTimeUpdate,
  onSeeked,
  effectiveDuration,
  onSeek
}: {
  meeting: Meeting;
  currentTime: number;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  onLoadedMetadata: React.ReactEventHandler<HTMLVideoElement>;
  onTimeUpdate: React.ReactEventHandler<HTMLVideoElement>;
  onSeeked: React.ReactEventHandler<HTMLVideoElement>;
  effectiveDuration: number;
  onSeek: (t: number) => void;
}) {
  // Track whether the user has started the video, so we can overlay a poster
  // play-icon over the first frame and hide it on play.
  const [hasStarted, setHasStarted] = useState(false);

  // Thumbnail load tracking: shows a theme-aware skeleton while the poster is
  // being fetched, and stays in place if the URL is missing or fails.
  type ThumbState = "idle" | "loading" | "loaded" | "error";
  const [thumbState, setThumbState] = useState<ThumbState>(
    meeting.thumbnailUrl ? "loading" : "idle"
  );
  useEffect(() => {
    if (!meeting.thumbnailUrl) {
      setThumbState("idle");
      return;
    }
    setThumbState("loading");
    const img = new Image();
    let cancelled = false;
    img.onload = () => {
      if (!cancelled) setThumbState("loaded");
    };
    img.onerror = () => {
      if (!cancelled) setThumbState("error");
    };
    img.src = meeting.thumbnailUrl;
    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [meeting.thumbnailUrl]);

  const handlePlayClick = () => {
    if (!videoRef.current) return;
    videoRef.current.play().catch(() => undefined);
  };

  const showSkeleton = thumbState === "loading" && !hasStarted;

  return (
    <Card padded>
      <div className="relative rounded-lg overflow-hidden border border-line bg-surfaceHi group/player">
        {meeting.recordingUrl ? (
          <>
            <video
              ref={videoRef}
              src={meeting.recordingUrl}
              poster={thumbState === "loaded" ? meeting.thumbnailUrl : undefined}
              controls={hasStarted}
              preload="metadata"
              playsInline
              className="w-full aspect-video bg-black"
              onLoadedMetadata={onLoadedMetadata}
              onTimeUpdate={onTimeUpdate}
              onSeeked={onSeeked}
              onPlay={() => setHasStarted(true)}
            />

            {/* Theme-aware skeleton while the thumbnail is downloading. */}
            {showSkeleton && (
              <div className="absolute inset-0 pointer-events-none">
                <Skeleton className="absolute inset-0 rounded-none" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="w-12 h-12 rounded-full border-2 border-line border-t-transparent animate-spin" />
                </div>
              </div>
            )}

            {!hasStarted && !showSkeleton && (
              <button
                type="button"
                onClick={handlePlayClick}
                aria-label="Play recording"
                className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-[1px] transition-all duration-200 hover:bg-black/40 focus-ring"
              >
                <span className="absolute inset-0 bg-gradient-to-b from-black/0 via-black/0 to-black/40" />
                <span className="relative w-16 h-16 lg:w-20 lg:h-20 rounded-full bg-white/95 text-bg flex items-center justify-center shadow-pop transition-transform duration-200 group-hover/player:scale-105 group-hover/player:bg-white">
                  <span className="ml-0.5">
                    <Icon.Play size={28} className="text-bg" />
                  </span>
                </span>
                <span className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-white text-[11px] font-mono tabular-nums opacity-80">
                  <span className="px-1.5 py-0.5 rounded bg-black/40 backdrop-blur-sm">
                    {platformLabel(meeting.platform)} · {meeting.meetingName?.trim() || meeting.sessionId.slice(0, 16)}
                  </span>
                  {effectiveDuration > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-black/40 backdrop-blur-sm">
                      {formatDuration(effectiveDuration)}
                    </span>
                  )}
                </span>
              </button>
            )}
          </>
        ) : (
          <div className="w-full aspect-video bg-surfaceHi flex flex-col items-center justify-center gap-2 text-inkMute text-sm">
            <div className="w-10 h-10 rounded-lg border border-line bg-surface flex items-center justify-center">
              <Icon.Mic size={16} />
            </div>
            Recording unavailable — transcript only
          </div>
        )}
      </div>

      <div className="mt-4">
        <SentimentTimeline
          segments={meeting.diarizedTranscript}
          durationSeconds={effectiveDuration}
          currentTime={currentTime}
          onSeek={onSeek}
          height={10}
        />
        <div className="mt-2.5 flex items-center justify-between text-[11px] text-inkMute font-mono">
          <span className="tabular-nums text-ink">{formatDuration(currentTime)}</span>
          <div className="flex items-center gap-3">
            <Legend swatch="bg-positive" label="Positive" />
            <Legend swatch="bg-neutral" label="Neutral" />
            <Legend swatch="bg-negative" label="Negative" />
          </div>
          <span className="tabular-nums">{formatDuration(effectiveDuration)}</span>
        </div>
      </div>
    </Card>
  );
}

function TabBar({
  tab,
  onChange,
  meeting
}: {
  tab: Tab;
  onChange: (tab: Tab) => void;
  meeting: Meeting;
}) {
  // Speakers count must match what SpeakersTab actually renders — it derives
  // the list from diarizedTranscript (one entry per distinct speaker who
  // appeared in any segment), NOT from sentimentSummary.perSpeaker (which
  // only includes the top few speakers that had enough volume to score).
  const speakerCount = new Set(meeting.diarizedTranscript.map((s) => s.speaker)).size;
  // Use the same derivation MomentsTab uses so the badge matches the body.
  const momentsCount = deriveMoments(meeting).length;
  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: "summary", label: "Summary" },
    { id: "actions", label: "Action items", count: meeting.actionItems.length },
    { id: "moments", label: "Moments", count: momentsCount },
    { id: "speakers", label: "Speakers", count: speakerCount }
  ];

  // Animated underline indicator
  const trackRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    summary: null,
    actions: null,
    moments: null,
    speakers: null
  });
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const node = tabRefs.current[tab];
    if (!node || !trackRef.current) return;
    const trackRect = trackRef.current.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    setIndicator({ left: rect.left - trackRect.left, width: rect.width });
  }, [tab]);

  return (
    <div
      ref={trackRef}
      className="relative flex items-center gap-1 px-3 border-b border-line bg-overlay-soft overflow-x-auto mask-fade-r"
    >
      {tabs.map((item) => {
        const active = tab === item.id;
        return (
          <button
            key={item.id}
            ref={(el) => {
              tabRefs.current[item.id] = el;
            }}
            type="button"
            onClick={() => onChange(item.id)}
            className={`relative flex items-center gap-1.5 px-3.5 h-11 text-[13px] whitespace-nowrap transition-colors focus-ring rounded ${
              active ? "text-ink" : "text-inkMute hover:text-ink"
            }`}
          >
            <span>{item.label}</span>
            {!!item.count && (
              <span className="text-[10px] tabular-nums text-inkFaint">{item.count}</span>
            )}
          </button>
        );
      })}
      <span
        className="tab-indicator"
        style={{ left: indicator.left, width: indicator.width }}
      />
    </div>
  );
}

function SummaryTab({ meeting }: { meeting: Meeting; onSeek: (t: number) => void }) {
  // Prefer the AI's structured purpose + key takeaways from momReport. When
  // those aren't populated yet (older meetings before this schema landed, or
  // a meeting whose mom hasn't been regenerated), fall back to the original
  // sentence-split bullet view of meeting.summary.
  const purpose = meeting.momReport?.meetingPurpose?.trim()
    || meeting.momReport?.executiveSummary?.trim()
    || meeting.summary?.trim()?.split(/(?<=[.!?])\s+(?=[A-Z(])/)[0]?.trim();
  const takeaways = (meeting.momReport?.keyTakeaways ?? []).filter((t) => t.title?.trim());
  const fallbackBullets = takeaways.length === 0 ? splitSummaryIntoBullets(meeting.summary) : [];

  if (!purpose && takeaways.length === 0 && fallbackBullets.length === 0) {
    return (
      <p className="text-sm text-inkMute italic text-center py-8">
        No summary available yet.
      </p>
    );
  }

  return (
    <div className="space-y-7">
      {purpose && (
        <section>
          <h3 className="text-[15px] font-semibold text-ink mb-2 tracking-tight">
            Meeting Purpose
          </h3>
          <p className="text-[14.5px] leading-relaxed text-inkSoft">{purpose}</p>
        </section>
      )}

      {takeaways.length > 0 && (
        <section>
          <h3 className="text-[15px] font-semibold text-ink mb-3 tracking-tight">
            Key Takeaways
          </h3>
          <ul className="space-y-2.5 text-[14.5px] leading-relaxed text-inkSoft">
            {takeaways.map((t, i) => (
              <li key={i} className="relative pl-5">
                <span
                  aria-hidden
                  className="absolute left-0 top-[0.6em] w-1.5 h-1.5 rounded-full bg-brand-500"
                />
                <strong className="text-ink font-semibold">{t.title}:</strong>
                {t.detail ? ` ${t.detail}` : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {takeaways.length === 0 && fallbackBullets.length > 0 && (
        <section>
          <h3 className="text-[15px] font-semibold text-ink mb-3 tracking-tight">
            Key Takeaways
          </h3>
          <ul className="space-y-2.5 text-[14.5px] leading-relaxed text-inkSoft">
            {fallbackBullets.map((point, i) => (
              <li key={i} className="relative pl-5">
                <span
                  aria-hidden
                  className="absolute left-0 top-[0.6em] w-1.5 h-1.5 rounded-full bg-brand-500"
                />
                {point}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// Turn the AI's paragraph summary into bullet points by splitting on sentence
// boundaries. Splits after `.`, `!`, or `?` only when followed by whitespace
// and an uppercase letter — that preserves abbreviations ("U.K.") and decimals
// ("2.5x"). Also tolerates summaries the model already returned as a list
// (newlines or leading "-"/"•" markers) by treating each line as its own item.
function splitSummaryIntoBullets(summary: string | null | undefined): string[] {
  const text = (summary ?? "").trim();
  if (!text) return [];

  // Prefer line-based splits if the model already formatted as a list.
  const lineSplit = text
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*[-•*]\s*/, "").trim())
    .filter(Boolean);
  if (lineSplit.length > 1) return lineSplit;

  return text
    .split(/(?<=[.!?])\s+(?=[A-Z(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Returns the moments to render in MomentsTab + the badge count. Prefers the
// AI-generated `topMoments` when available; otherwise falls back to deriving
// them from the diarized transcript by picking the segments with the highest
// absolute sentiment score. The fallback dedupes consecutive same-speaker
// hits so one excited monologue doesn't fill the whole list. Always caps at
// 5 so we mirror the server-side cap.
function deriveMoments(meeting: Meeting): SentimentMoment[] {
  const ai = meeting.sentimentSummary?.topMoments ?? [];
  if (ai.length > 0) return ai;

  type Scored = { segment: Meeting["diarizedTranscript"][number]; abs: number };
  const scored: Scored[] = [];
  for (const segment of meeting.diarizedTranscript) {
    const score = segment.sentiment?.score;
    if (typeof score !== "number") continue;
    if (Math.abs(score) < 0.15) continue; // ignore near-neutral noise
    scored.push({ segment, abs: Math.abs(score) });
  }
  scored.sort((a, b) => b.abs - a.abs);

  const picked: SentimentMoment[] = [];
  const seenSpeakers = new Map<string, number>();
  for (const { segment } of scored) {
    if (picked.length >= 5) break;
    const speaker = segment.speaker ?? "";
    // Allow up to 2 moments per speaker so a dominant speaker doesn't crowd
    // out everyone else, but very-active speakers can still surface twice.
    if ((seenSpeakers.get(speaker) ?? 0) >= 2) continue;
    seenSpeakers.set(speaker, (seenSpeakers.get(speaker) ?? 0) + 1);
    picked.push({
      startTime: segment.startTime,
      endTime: segment.endTime,
      label: segment.sentiment!.label,
      score: segment.sentiment!.score,
      quote: segment.text.length > 200 ? `${segment.text.slice(0, 197)}…` : segment.text,
      speaker
    });
  }

  // Render in chronological order so the list reads top → bottom as a timeline.
  picked.sort((a, b) => a.startTime - b.startTime);
  return picked;
}

function ActionsTab({ meeting }: { meeting: Meeting }) {
  const [done, setDone] = useState<Record<number, boolean>>({});
  if (meeting.actionItems.length === 0) {
    return (
      <p className="text-sm text-inkMute italic text-center py-8">
        No action items captured for this meeting.
      </p>
    );
  }
  const completed = Object.values(done).filter(Boolean).length;
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-inkMute">
          {meeting.actionItems.length} item{meeting.actionItems.length === 1 ? "" : "s"} ·
          tap to mark complete
        </p>
        <span className="text-[11px] text-inkMute tabular-nums">
          {completed}/{meeting.actionItems.length} done
        </span>
      </div>
      <ul className="space-y-2">
        {meeting.actionItems.map((item, index) => {
          const isDone = !!done[index];
          return (
            <li
              key={index}
              className="animate-fade-up"
              style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
            >
              <button
                type="button"
                onClick={() => setDone((d) => ({ ...d, [index]: !d[index] }))}
                className="w-full text-left rounded-lg p-3.5 border border-line hover:border-lineHi hover:bg-surfaceHi transition-colors focus-ring flex items-start gap-3 group"
              >
                <span
                  className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                    isDone
                      ? "bg-positive border-positive text-white"
                      : "border-lineHi bg-surface group-hover:border-positive"
                  }`}
                >
                  {isDone && <Icon.Check size={11} />}
                </span>
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-[14px] leading-snug ${
                      isDone ? "text-inkMute line-through" : "text-ink"
                    }`}
                  >
                    {item.task}
                  </p>
                  {item.assignee && (
                    <span className="text-[11px] text-inkMute mt-0.5 inline-flex items-center gap-1.5">
                      <Avatar name={item.assignee} size={16} />
                      {item.assignee}
                    </span>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MomentsTab({
  meeting,
  onSeek
}: {
  meeting: Meeting;
  onSeek: (t: number) => void;
}) {
  const moments = deriveMoments(meeting);
  if (moments.length === 0) {
    return (
      <p className="text-sm text-inkMute italic text-center py-8">
        No key moments detected for this meeting.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {moments.map((moment, index) => (
        <li
          key={index}
          className="animate-fade-up"
          style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
        >
          <button
            type="button"
            onClick={() => onSeek(moment.startTime)}
            className="w-full text-left rounded-lg p-4 border border-line hover:border-lineHi hover:bg-surfaceHi transition-colors group focus-ring"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {moment.speaker && <Avatar name={moment.speaker} size={20} />}
                <span className="text-[12.5px] text-inkSoft">{moment.speaker ?? "—"}</span>
                <Badge tone={sentimentTone(moment.label)}>{moment.label}</Badge>
              </div>
              <span className="text-[11px] text-inkMute font-mono tabular-nums group-hover:text-ink transition-colors">
                {formatDuration(moment.startTime)}
              </span>
            </div>
            {moment.quote && (
              <p className="text-[14.5px] text-ink leading-snug italic">“{moment.quote}”</p>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function SpeakersTab({
  meeting,
  onFilter,
  activeSpeaker
}: {
  meeting: Meeting;
  onFilter: (name: string) => void;
  activeSpeaker?: string | null;
}) {
  const counts = new Map<string, number>();
  meeting.diarizedTranscript.forEach((segment) => {
    counts.set(segment.speaker, (counts.get(segment.speaker) ?? 0) + 1);
  });
  const list = Array.from(counts.entries()).map(([name, count]) => ({
    name,
    count,
    sentiment: meeting.sentimentSummary?.perSpeaker.find((s) => s.speaker === name)
  }));
  list.sort((a, b) => b.count - a.count);

  if (list.length === 0) {
    return (
      <p className="text-sm text-inkMute italic text-center py-8">No speakers detected.</p>
    );
  }
  const max = Math.max(...list.map((entry) => entry.count));

  return (
    <ul className="space-y-2">
      {list.map((entry) => {
        const isActive = activeSpeaker === entry.name;
        return (
        <li key={entry.name}>
          <button
            type="button"
            onClick={() => onFilter(isActive ? "" : entry.name)}
            className={`w-full text-left rounded-lg p-3 border transition-colors group focus-ring flex items-center gap-3 ${
              isActive
                ? "border-brand-500/60 bg-brand-500/5"
                : "border-line hover:border-lineHi hover:bg-surfaceHi"
            }`}
          >
            <Avatar name={entry.name} size={32} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[14px] text-ink truncate">{entry.name}</p>
                <p className="text-[11px] text-inkMute tabular-nums">
                  {entry.count} segments
                </p>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-surfaceHi overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-brand-500 to-brand-700"
                  style={{ width: `${(entry.count / max) * 100}%` }}
                />
              </div>
            </div>
            {entry.sentiment && (
              <Badge tone={sentimentTone(entry.sentiment.label)}>
                {entry.sentiment.score.toFixed(2)}
              </Badge>
            )}
            {isActive ? (
              <span className="text-[11px] text-brand-500 dark:text-brand-400 font-medium">
                Filtering
              </span>
            ) : (
              <Icon.ArrowRight
                size={14}
                className="text-inkFaint group-hover:text-ink group-hover:translate-x-0.5 transition-all"
              />
            )}
          </button>
        </li>
        );
      })}
    </ul>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${swatch}`} />
      <span className="text-inkMute">{label}</span>
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] uppercase tracking-widest text-inkMute">{children}</h2>
  );
}

function DownloadTranscriptButton({ meeting, title }: { meeting: Meeting; title: string }) {
  // Icon-only sibling of CopyTranscriptButton — same content, same panel,
  // saved to disk instead of the clipboard.
  if (meeting.diarizedTranscript.length === 0) return null;

  const handleDownload = () => {
    const text = buildFathomTranscript(meeting);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const safeTitle =
      title.replace(/[^\w\-\s.]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) ||
      "transcript";
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeTitle}-transcript.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      aria-label="Download transcript"
      title="Download transcript (TXT)"
      className="group inline-flex items-center justify-center w-8 h-7 bg-transparent text-ink hover:bg-surfaceHi transition-colors focus-ring"
    >
      <Icon.Download
        size={13}
        className="text-inkSoft group-hover:text-brand-500 dark:group-hover:text-brand-400 transition-transform group-hover:translate-y-0.5"
      />
    </button>
  );
}

function DownloadVideoButton({ meeting }: { meeting: Meeting; title: string }) {
  if (!meeting.recordingUrl) return null;

  // Same-origin proxy endpoint — backend streams the Azure blob with
  // Content-Disposition: attachment, so the browser saves the file directly
  // instead of opening it in a new tab.
  const href = `/api/meetings/${encodeURIComponent(meeting.sessionId)}/recording`;

  return (
    <a
      href={href}
      download
      title="Download recording (MP4)"
      aria-label="Download video"
      className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg border border-line bg-surface text-[12.5px] font-medium text-ink hover:border-lineHi hover:bg-surfaceHi transition-colors focus-ring shrink-0"
    >
      <span className="w-5 h-5 rounded-md bg-brand-500/10 text-brand-500 flex items-center justify-center">
        <Icon.Video size={12} />
      </span>
      Download video
    </a>
  );
}

// Preview-first Minutes-of-Meeting: opens a modal that renders the ACTUAL
// report (the same styled HTML we download) in a sandboxed blob-URL iframe, with
// a Download button inside. Users see it before deciding to save it.
function DownloadMomButton({ meeting, title }: { meeting: Meeting; title: string }) {
  const [open, setOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const safeTitle = title.replace(/[^\w\-\s.]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "meeting";

  // Render the report into a blob URL while the modal is open (CSP allows a
  // blob: iframe). Revoke it on close so we don't leak object URLs.
  useEffect(() => {
    if (!open) return;
    const url = URL.createObjectURL(new Blob([buildMomHtml(meeting)], { type: "text/html;charset=utf-8" }));
    setPreviewUrl(url);
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => {
      URL.revokeObjectURL(url);
      setPreviewUrl(null);
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [open, meeting]);

  const download = () => {
    const url = URL.createObjectURL(new Blob([buildMomHtml(meeting)], { type: "text/html;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeTitle}-MOM.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Preview Minutes of Meeting"
        aria-label="Preview MOM"
        className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg border border-line bg-surface text-[12.5px] font-medium text-ink hover:border-lineHi hover:bg-surfaceHi transition-colors focus-ring shrink-0"
      >
        <span className="w-5 h-5 rounded-md bg-brand-500/10 text-brand-500 flex items-center justify-center">
          <Icon.Sparkles size={12} />
        </span>
        View MOM
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-scrim p-3 sm:p-6"
            onClick={() => setOpen(false)}
          >
            <div
              className="relative flex max-h-[94vh] w-full max-w-[1000px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 border-b border-line bg-overlay-soft px-5 py-3.5">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-500">
                    <Icon.Sparkles size={16} />
                  </span>
                  <div className="leading-tight min-w-0">
                    <p className="text-[14.5px] font-semibold text-ink">Minutes of Meeting</p>
                    <p className="text-[11.5px] text-inkMute line-clamp-1">{title}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={download}
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-500 px-4 text-[13px] font-semibold text-white hover:bg-brand-600 transition-colors focus-ring"
                  >
                    <Icon.Download size={14} /> Download
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                    className="grid h-9 w-9 place-items-center rounded-lg border border-line text-inkMute hover:bg-line/40 hover:text-ink transition-colors focus-ring"
                  >
                    <Icon.Close size={16} />
                  </button>
                </div>
              </div>
              {previewUrl ? (
                <iframe
                  src={previewUrl}
                  title="Minutes of Meeting preview"
                  className="h-[82vh] w-full border-0 bg-white"
                />
              ) : (
                <div className="grid h-[60vh] place-items-center text-inkMute">
                  <span className="w-6 h-6 rounded-full border-2 border-brand-500/30 border-t-brand-500 animate-spin" />
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function CopyTranscriptButton({ meeting }: { meeting: Meeting }) {
  const [copied, setCopied] = useState(false);
  const disabled = meeting.diarizedTranscript.length === 0;

  const handleCopy = async () => {
    if (disabled) return;
    const text = buildFathomTranscript(meeting);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Older browsers / non-secure contexts fall back to a hidden textarea.
        const node = document.createElement("textarea");
        node.value = text;
        node.style.position = "fixed";
        node.style.opacity = "0";
        document.body.appendChild(node);
        node.select();
        document.execCommand("copy");
        document.body.removeChild(node);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Swallow — the user can manually select the transcript if the clipboard
      // API is blocked.
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={disabled}
      aria-label="Copy transcript"
      title={copied ? "Copied!" : "Copy transcript"}
      className="inline-flex items-center gap-1.5 h-7 px-2.5 bg-transparent text-[11.5px] text-ink hover:bg-surfaceHi transition-colors focus-ring disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {copied ? <Icon.Check size={12} /> : <Icon.Copy size={12} />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function uniqueSpeakers(meeting: Meeting): string[] {
  return [...new Set(meeting.diarizedTranscript.map((s) => s.speaker).filter(Boolean))];
}

function DetailSkeleton() {
  return (
    <div className="max-w-[1280px] mx-auto px-6 lg:px-12 py-10">
      <Skeleton className="h-4 w-24 mb-5" />
      <Skeleton className="h-8 w-1/2 mb-2" />
      <Skeleton className="h-3 w-1/3 mb-8" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Skeleton className="aspect-video w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    </div>
  );
}
