export const botPlatforms = ["google_meet", "microsoft_teams", "zoom"] as const;
export type BotPlatform = (typeof botPlatforms)[number];

export const botStatuses = [
  "queued",
  "starting",
  "joining",
  "recording",
  "uploading",
  "processing",
  "awaiting_transcript",
  "transcript_ready",
  "transcript_unavailable",
  "completed",
  "failed"
] as const;
export type BotStatus = (typeof botStatuses)[number];

export type ParticipantSource = "participant_panel" | "caption_label" | "diarization_cluster";

export interface Participant {
  name: string;
  source?: ParticipantSource;
  // Optional org/role label sourced from calendar metadata (Google/Teams) when
  // the join URL exposes the inviting tenant or domain. When set, frontends
  // render the speaker as "Name (Company)" in transcripts and exports.
  company?: string;
}

export interface ParticipantTimelineEntry {
  name: string;
  joinTime: Date;
  leaveTime?: Date | null;
  firstSeen?: Date;
  lastSeen?: Date;
}

export interface CaptionTimelineEntry {
  speaker?: string;
  text: string;
  time: Date;
  source: "ui_caption";
}

export const sentimentLabels = ["positive", "neutral", "negative"] as const;
export type SentimentLabel = (typeof sentimentLabels)[number];

export interface SentimentScore {
  label: SentimentLabel;
  // Scalar between -1 (most negative) and 1 (most positive). Frontend uses
  // this for the timeline heatmap and the per-speaker average chips.
  score: number;
}

export interface SentimentMoment {
  startTime: number;
  endTime: number;
  label: SentimentLabel;
  score: number;
  // Short quote / context from the transcript for the moment, surfaced in the
  // detail page's "highlights" rail.
  quote?: string;
  speaker?: string;
}

export interface PerSpeakerSentiment {
  speaker: string;
  label: SentimentLabel;
  score: number;
  segmentCount: number;
}

export interface SentimentSummary {
  overall: SentimentScore;
  perSpeaker: PerSpeakerSentiment[];
  topMoments: SentimentMoment[];
}

export interface DiarizedTranscriptSegment {
  speaker: string;
  text: string;
  startTime: number;
  endTime: number;
  confidence?: number;
  clusterId?: string;
  // The text exactly as spoken (native script / code-mix), retained when the
  // Whisper provider translates `text` into English for a non-English meeting.
  // Absent for English meetings and for the Sarvam flow (which never translates),
  // so renderers should fall back to `text` when this is missing.
  originalText?: string;
  // BCP-47-ish language tag detected for this segment ("en", "hi", "gu", ...).
  // Optional and additive; legacy sessions and the Sarvam flow leave it unset.
  language?: string;
  // Per-segment sentiment, produced alongside the summary by the AI service.
  // Optional because legacy sessions predate the field; the frontend should
  // treat missing values as "neutral / 0".
  sentiment?: SentimentScore;
}

export interface ActionItem {
  task: string;
  assignee?: string | null;
}

export interface MeetingChapter {
  // Short topic / chapter title (3-8 words). The AI emits a new chapter each
  // time the conversation's subject shifts meaningfully.
  title: string;
  // Seconds from the meeting start. Matches the diarizedTranscript timestamps
  // so the UI can seek the player to this point.
  startTime: number;
}

// Rich Minutes-of-Meeting report. Produced by MomReportService after the base
// summary is available and persisted on the session so the frontend can hand
// out a styled HTML download without making any extra AI calls.
export type MomPriority = "high" | "medium" | "low";
export type MomStatus = "open" | "in_progress" | "planned" | "done";
export type MomRiskSeverity = "amber" | "red";

export interface MomToneBreakdown {
  // Whole-number percentages summing close to 100. UI clamps each to [0,100].
  positive: number;
  neutral: number;
  concerns: number;
}

export interface MomNotableQuote {
  text: string;
  speaker: string;
  company?: string;
}

export interface MomPositiveOrConcern {
  title: string;
  detail: string;
}

export interface MomMomItem {
  // segment index in diarizedTranscript that marks the start of the topic.
  index: number;
  tag: string;
  topic: string;
  body: string;
}

export interface MomActionItemDetail {
  task: string;
  detail?: string;
  // One action item can be owned by multiple people. `owners` is the source of
  // truth; `owner` is kept for backward-compat with reports generated before
  // multi-owner support (renderers fall back to it when `owners` is absent).
  owners?: string[];
  owner?: string;
  due?: string;
  priority?: MomPriority;
  status?: MomStatus;
}

export interface MomTodo {
  title: string;
  detail: string;
  owner?: string;
  priority?: MomPriority | "critical";
  due?: string;
}

export interface MomRisk {
  severity: MomRiskSeverity;
  title: string;
  detail: string;
  owner?: string;
}

export interface MomNextStep {
  period: string;
  title: string;
  detail: string;
}

export interface MomAttendee {
  name: string;
  role?: string;
  initials?: string;
}

export interface MomKeyTakeaway {
  // Short bold lead-in shown on the takeaway line (e.g. "Team Transition",
  // "Sprint Focus"). 2-5 words; no trailing colon — the renderer adds it.
  title: string;
  // One sentence (or two short ones) of substance about that takeaway.
  detail: string;
}

export interface MomReport {
  executiveSummary: string;
  // One sentence stating what the meeting was for — used as the "Meeting
  // Purpose" line on the Summary tab. Falls back to executiveSummary when
  // the model can't pin it down.
  meetingPurpose?: string;
  keyTakeaways?: MomKeyTakeaway[];
  toneBreakdown: MomToneBreakdown;
  notableQuotes: MomNotableQuote[];
  positives: MomPositiveOrConcern[];
  concerns: MomPositiveOrConcern[];
  momSections: MomMomItem[];
  actionItems: MomActionItemDetail[];
  topTodos: MomTodo[];
  risks: MomRisk[];
  nextSteps: MomNextStep[];
  attendees: MomAttendee[];
  generatedAt: Date;
  source: "ai" | "ai_error" | "ai_returned_empty" | "fallback";
  generationError?: string;
}

export type MeetingLogLevel = "debug" | "info" | "warn" | "error";

export type MeetingLogPhase =
  | "session"
  | "queue"
  | "browser"
  | "join"
  | "recording"
  | "capture"
  | "upload"
  | "processing"
  | "transcription"
  | "retry"
  | "summary"
  | "webhook"
  | "completion"
  | "failure";

export interface MeetingLogEntry {
  time: Date;
  level: MeetingLogLevel;
  phase: MeetingLogPhase;
  event: string;
  message: string;
  status?: BotStatus;
  metadata?: Record<string, unknown>;
}

export interface TranscriptPollingState {
  onlineMeetingId?: string;
  transcriptId?: string;
  retryCount: number;
  pollAttemptCount: number;
  firstPollAt?: Date;
  lastPollAt?: Date;
  nextRetryAt?: Date;
  pendingDurationMs?: number;
  lastGraphStatus?: number;
  lastGraphError?: string;
  finalFailureReason?: string;
}

export interface MeetingIntelligenceResult {
  participants: Participant[];
  participantsTimeline: ParticipantTimelineEntry[];
  captionsTimeline: CaptionTimelineEntry[];
  diarizedTranscript: DiarizedTranscriptSegment[];
  transcriptText: string;
  summary: string;
  chapters?: MeetingChapter[];
  actionItems: ActionItem[];
  sentimentSummary?: SentimentSummary;
  meetingLogs?: MeetingLogEntry[];
  meetingName?: string;
  recordingUrl: string;
  thumbnailUrl?: string;
  momReport?: MomReport;
  startedAt: Date;
  endedAt: Date;
}

// Details needed to auto-join a meeting discovered on a connected calendar.
// Carried on the delayed BullMQ job; the worker creates the BotSession at
// fire-time, so there's no sessionId yet.
export interface CalendarJoinPayload {
  userId: string;
  platform: BotPlatform;
  meetingUrl: string;
  meetingPasscode?: string;
  title?: string;
  startTime: string; // ISO of the event start
  endTime?: string; // ISO of the event end (drives the live-window check)
  // Cross-user per-instance dedup key: `dedupeKey(joinUrl)#startISO` (NO userId,
  // so every user invited to the same meeting collapses to one bot).
  meetingInstanceKey: string;
  // Normalized join-url key (dedupeKey(joinUrl)) — stored on the session so the
  // manual "Join Meeting" path can find an already-live bot for the same link.
  meetingDedupeKey: string;
}

export interface BotJobPayload {
  // Present for run_bot / poll_teams_transcript; absent for calendar_join
  // (the session is created when that job fires).
  sessionId?: string;
  kind?: "run_bot" | "poll_teams_transcript" | "calendar_join";
  retryCount?: number;
  calendar?: CalendarJoinPayload;
}
