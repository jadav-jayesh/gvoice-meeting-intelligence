import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Avatar } from "../components/ui/Avatar";
import { Icon } from "../components/Icon";
import { BrandLogo } from "../components/BrandLogo";
import { TranscriptList } from "../components/TranscriptList";
import { SentimentTimeline } from "../components/SentimentTimeline";
import { getPublicMeeting, type PublicMeeting } from "../lib/api";
import {
  formatDuration,
  formatRelative,
  platformLabel,
  platformTone,
  sentimentTone
} from "../lib/format";

export function SharedMeetingPage() {
  const { token } = useParams<{ token: string }>();
  const [meeting, setMeeting] = useState<PublicMeeting | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);

  useEffect(() => {
    let alive = true;
    if (!token) {
      setState("error");
      return;
    }
    setState("loading");
    getPublicMeeting(token)
      .then((m) => {
        if (!alive) return;
        setMeeting(m);
        setState("ready");
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
    };
  }, [token]);

  const transcriptDuration = useMemo(() => {
    const segs = meeting?.diarizedTranscript ?? [];
    return segs.length ? Math.max(...segs.map((s) => s.endTime || 0)) : 0;
  }, [meeting]);
  const effectiveDuration = videoDuration || transcriptDuration;

  function handleSeek(time: number) {
    if (!videoRef.current) return;
    videoRef.current.currentTime = time;
    videoRef.current.play().catch(() => undefined);
  }

  if (state === "loading") {
    return (
      <Shell>
        <div className="grid place-items-center py-32 text-inkMute">
          <span className="w-6 h-6 rounded-full border-2 border-brand-500/30 border-t-brand-500 animate-spin" />
        </div>
      </Shell>
    );
  }

  if (state === "error" || !meeting) {
    return (
      <Shell>
        <Card padded className="max-w-md mx-auto mt-24 text-center">
          <span className="grid h-11 w-11 mx-auto place-items-center rounded-xl bg-negative/10 text-negative">
            <Icon.AlertCircle size={20} />
          </span>
          <h1 className="mt-4 text-[18px] font-semibold text-ink">This shared meeting isn’t available</h1>
          <p className="mt-1.5 text-[13px] text-inkMute">
            The link may have been revoked, or it’s incorrect. Ask the person who shared it for a new link.
          </p>
          <Link
            to="/"
            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-brand-500 text-white text-[13px] font-medium hover:bg-brand-600 focus-ring"
          >
            Go to gVoice
          </Link>
        </Card>
      </Shell>
    );
  }

  const overall = meeting.sentimentSummary?.overall;
  const title = (meeting.meetingName?.trim() || meeting.summary?.split(/[.!?]/)[0]?.trim() || "Shared meeting").slice(
    0,
    140
  );
  const chapters = meeting.chapters ?? [];

  return (
    <Shell>
      {/* Meeting header */}
      <header className="mb-7">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Badge dot tone={platformTone(meeting.platform)}>
            {platformLabel(meeting.platform)}
          </Badge>
          {overall && (
            <Badge tone={sentimentTone(overall.label)}>
              {overall.label} · {overall.score.toFixed(2)}
            </Badge>
          )}
          <Badge tone="neutral">Shared · read-only</Badge>
        </div>
        <h1 className="text-[26px] lg:text-[32px] font-semibold tracking-tightest text-ink leading-tight">{title}</h1>
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
              {meeting.participants.length} participant{meeting.participants.length === 1 ? "" : "s"}
            </span>
          )}
          {meeting.meetingLanguage && (
            <span className="inline-flex items-center gap-1.5 uppercase tracking-wide">{meeting.meetingLanguage}</span>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-5">
          {meeting.hasRecording && meeting.recordingUrl ? (
            <Card className="overflow-hidden p-0">
              <video
                ref={videoRef}
                controls
                playsInline
                poster={meeting.thumbnailUrl}
                className="w-full aspect-video bg-black"
                onLoadedMetadata={(e) => setVideoDuration(e.currentTarget.duration || 0)}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
                onSeeked={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
              >
                <source src={meeting.recordingUrl} type="video/mp4" />
              </video>
              {effectiveDuration > 0 && meeting.diarizedTranscript.length > 0 && (
                <div className="px-4 py-3 border-t border-line">
                  <SentimentTimeline
                    segments={meeting.diarizedTranscript}
                    durationSeconds={effectiveDuration}
                    currentTime={currentTime}
                    onSeek={handleSeek}
                  />
                </div>
              )}
            </Card>
          ) : null}

          {meeting.summary?.trim() && (
            <Card padded>
              <SectionTitle icon={<Icon.Sparkles size={14} />}>Summary</SectionTitle>
              <div className="mt-3 space-y-3 text-[14px] leading-relaxed text-ink/90">
                {meeting.summary
                  .split(/\n{2,}/)
                  .filter(Boolean)
                  .map((para, i) => (
                    <p key={i}>{para.trim()}</p>
                  ))}
              </div>
            </Card>
          )}

          {chapters.length > 0 && (
            <Card padded>
              <SectionTitle icon={<Icon.Clock size={14} />}>Chapters</SectionTitle>
              <ul className="mt-3 divide-y divide-line/70">
                {chapters.map((c, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => handleSeek(c.startTime)}
                      className="w-full flex items-center gap-3 py-2.5 text-left group focus-ring rounded"
                    >
                      <span className="font-mono text-[11.5px] tabular-nums text-brand-500 shrink-0">
                        {formatDuration(c.startTime)}
                      </span>
                      <span className="text-[13.5px] text-ink group-hover:text-brand-600 transition-colors">
                        {c.title}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {meeting.diarizedTranscript.length > 0 && (
            <Card padded>
              <SectionTitle icon={<Icon.Users size={14} />}>Transcript</SectionTitle>
              <TranscriptList
                segments={meeting.diarizedTranscript}
                currentTime={currentTime}
                onSeek={handleSeek}
                className="mt-3 max-h-[520px] overflow-y-auto pr-1"
              />
            </Card>
          )}
        </div>

        {/* Side rail */}
        <aside className="space-y-5">
          {meeting.participants.length > 0 && (
            <Card padded>
              <SectionTitle icon={<Icon.Users size={14} />}>Participants</SectionTitle>
              <ul className="mt-3 space-y-2.5">
                {meeting.participants.map((p, i) => (
                  <li key={i} className="flex items-center gap-2.5">
                    <Avatar name={p.name} size={26} />
                    <span className="text-[13.5px] text-ink truncate">{p.name}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {meeting.actionItems.length > 0 && (
            <Card padded>
              <SectionTitle icon={<Icon.CheckCircle size={14} />}>Action items</SectionTitle>
              <ul className="mt-3 space-y-3">
                {meeting.actionItems.map((a, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-brand-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[13.5px] text-ink leading-snug">{a.task}</p>
                      {a.assignee && <p className="text-[12px] text-inkMute mt-0.5">{a.assignee}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </Shell>
  );
}

function SectionTitle({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-inkMute">
      {icon}
      {children}
    </div>
  );
}

// Public chrome: a slim top bar with the gVoice wordmark + a CTA, and a footer
// note. No app shell / nav — this page is viewable by anyone with the link.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <div className="border-b border-line bg-surface/60 backdrop-blur sticky top-0 z-20">
        <div className="max-w-[1180px] mx-auto px-6 lg:px-10 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 focus-ring rounded">
            <BrandLogo height={26} />
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-line text-[12.5px] font-medium text-ink hover:bg-line/40 focus-ring"
          >
            <Icon.Sparkles size={13} />
            Powered by gVoice
          </Link>
        </div>
      </div>
      <main className="max-w-[1180px] mx-auto px-6 lg:px-10 py-8 lg:py-10 page-enter">{children}</main>
      <footer className="max-w-[1180px] mx-auto px-6 lg:px-10 pb-10 text-center text-[12px] text-inkMute">
        Shared securely via gVoice · read-only view
      </footer>
    </div>
  );
}
