import type { BotPlatform, BotStatus, Meeting, SentimentLabel } from "./types";

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${hours}:${String(m).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

export function formatRelative(iso: string | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

export function platformLabel(platform: BotPlatform): string {
  switch (platform) {
    case "google_meet":
      return "Meet";
    case "microsoft_teams":
      return "Teams";
    case "zoom":
      return "Zoom";
  }
}

export type BadgeTone = "neutral" | "positive" | "negative" | "warn" | "info" | "brand";

export function platformTone(platform: BotPlatform): BadgeTone {
  switch (platform) {
    case "google_meet":
      return "positive";
    case "microsoft_teams":
      return "info";
    case "zoom":
      return "brand";
  }
}

export function statusTone(status: BotStatus): BadgeTone {
  switch (status) {
    case "completed":
      return "positive";
    case "failed":
    case "transcript_unavailable":
      return "negative";
    case "queued":
    case "starting":
    case "joining":
    case "uploading":
    case "processing":
    case "awaiting_transcript":
      return "warn";
    case "recording":
      return "info";
    default:
      return "neutral";
  }
}

// Statuses where the bot/pipeline is still working on the session. The detail
// page keeps polling while the meeting is in one of these, and the download
// actions stay hidden until the session reaches "completed".
// "transcript_ready" is transient (the worker continues straight into summary
// and MoM generation), so it counts as in-progress; "completed", "failed" and
// "transcript_unavailable" are terminal.
const IN_PROGRESS_STATUSES: ReadonlySet<BotStatus> = new Set<BotStatus>([
  "queued",
  "starting",
  "joining",
  "recording",
  "uploading",
  "processing",
  "awaiting_transcript",
  "transcript_ready"
]);

export function isMeetingInProgress(status: BotStatus): boolean {
  return IN_PROGRESS_STATUSES.has(status);
}

export function sentimentTone(label: SentimentLabel | undefined): BadgeTone {
  switch (label) {
    case "positive":
      return "positive";
    case "negative":
      return "negative";
    default:
      return "neutral";
  }
}

export function sentimentSwatch(label: SentimentLabel | undefined): string {
  switch (label) {
    case "positive":
      return "bg-positive";
    case "negative":
      return "bg-negative";
    default:
      return "bg-neutral";
  }
}

// Legacy aliases — older files still call these names; map to tone strings or
// raw class names so they keep working until those files get rewritten.
export const platformColor = platformTone;
export const statusColor = statusTone;
export const sentimentColor = sentimentTone;
export const sentimentBarColor = sentimentSwatch;

// Render the meeting's diarized transcript in a Fathom-style plain-text block,
// suitable for pasting into a doc, ticket, or email. Consecutive segments by
// the same speaker share one leading timestamp; AI-generated topic chapters
// and sentiment highlights are interleaved with WATCH URLs so the reader can
// click straight to that point in the recording.
export function buildFathomTranscript(meeting: Meeting): string {
  const title =
    meeting.meetingName?.trim() ||
    (meeting.summary?.split(/[.!?]/)[0]?.trim() || "Meeting");
  const dateLabel = formatLongDate(meeting.startedAt ?? meeting.createdAt);
  const transcript = meeting.diarizedTranscript ?? [];
  const duration = transcript.length
    ? Math.max(...transcript.map((s) => s.endTime))
    : 0;
  const watchBase = buildWatchBase(meeting);
  const companyByName = buildCompanyLookup(meeting.participants ?? []);

  const lines: string[] = [];
  lines.push(dateLabel ? `${title} - ${dateLabel}` : title);
  if (meeting.recordingUrl) {
    const lengthLabel = duration > 0 ? formatLengthLong(duration) : "recording";
    lines.push(`VIEW RECORDING - ${lengthLabel}: ${meeting.recordingUrl}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // Group consecutive segments by speaker so each speaker block has one
  // leading timestamp like the Fathom share format.
  type Group = { speaker: string; startTime: number; text: string };
  const groups: Group[] = [];
  for (const segment of transcript) {
    const last = groups[groups.length - 1];
    if (last && last.speaker === segment.speaker) {
      last.text = `${last.text} ${segment.text}`.trim();
    } else {
      groups.push({ speaker: segment.speaker, startTime: segment.startTime, text: segment.text });
    }
  }

  const chapters = [...(meeting.chapters ?? [])].sort((a, b) => a.startTime - b.startTime);
  const moments = [...(meeting.sentimentSummary?.topMoments ?? [])].sort(
    (a, b) => a.startTime - b.startTime
  );
  let chapterIdx = 0;
  let momentIdx = 0;

  for (const group of groups) {
    while (chapterIdx < chapters.length && chapters[chapterIdx].startTime <= group.startTime) {
      lines.push(formatChapterLine(chapters[chapterIdx], watchBase));
      lines.push("");
      chapterIdx += 1;
    }
    while (momentIdx < moments.length && moments[momentIdx].startTime <= group.startTime) {
      lines.push(formatHighlightLine(moments[momentIdx], watchBase));
      lines.push("");
      momentIdx += 1;
    }
    lines.push(`${formatDuration(group.startTime)} - ${formatSpeakerLabel(group.speaker, companyByName)}`);
    lines.push(`  ${group.text}`);
    lines.push("");
  }
  while (chapterIdx < chapters.length) {
    lines.push(formatChapterLine(chapters[chapterIdx], watchBase));
    chapterIdx += 1;
  }
  while (momentIdx < moments.length) {
    lines.push(formatHighlightLine(moments[momentIdx], watchBase));
    momentIdx += 1;
  }

  return lines.join("\n").trim() + "\n";
}

function buildWatchBase(meeting: Meeting): string | undefined {
  if (typeof window === "undefined") return undefined;
  return `${window.location.origin}/meetings/${encodeURIComponent(meeting.sessionId)}`;
}

function formatWatchUrl(base: string | undefined, startTime: number): string | undefined {
  if (!base) return undefined;
  return `${base}?t=${Math.max(0, Math.floor(startTime))}`;
}

function buildCompanyLookup(participants: Array<{ name: string; company?: string }>): Map<string, string> {
  const map = new Map<string, string>();
  for (const participant of participants) {
    if (!participant.name || !participant.company) continue;
    map.set(participant.name.toLowerCase(), participant.company);
  }
  return map;
}

function formatSpeakerLabel(name: string, companies: Map<string, string>): string {
  const company = companies.get(name.toLowerCase());
  return company ? `${name} (${company})` : name;
}

function formatChapterLine(chapter: { title: string; startTime: number }, watchBase?: string): string {
  const stamp = formatDuration(chapter.startTime);
  const watch = formatWatchUrl(watchBase, chapter.startTime);
  const tail = watch ? ` - WATCH: ${watch}` : "";
  return `  BOOKMARK [${stamp}]: ${chapter.title}${tail}`;
}

function formatHighlightLine(
  moment: {
    startTime: number;
    speaker?: string;
    quote?: string;
    label: SentimentLabel;
  },
  watchBase?: string
): string {
  const stamp = formatDuration(moment.startTime);
  const who = moment.speaker ? ` ${moment.speaker} —` : "";
  const text = moment.quote ? `"${moment.quote}"` : `(${moment.label} moment)`;
  const watch = formatWatchUrl(watchBase, moment.startTime);
  const tail = watch ? ` - WATCH: ${watch}` : "";
  return `  HIGHLIGHT [${stamp}]${who} ${text}${tail}`;
}

function formatLengthLong(seconds: number): string {
  const total = Math.round(seconds);
  if (total < 60) return `${total} sec${total === 1 ? "" : "s"}`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining === 0
    ? `${hours} hr${hours === 1 ? "" : "s"}`
    : `${hours} hr ${remaining} min`;
}

function formatLongDate(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}
