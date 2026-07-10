// Mirrors the server-side types in src/types/meeting.ts. Kept hand-rolled
// rather than imported to avoid coupling the frontend build to the server
// tsconfig — the surface is small.

export type UserRole = "user" | "admin";

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
}

export type BotPlatform = "google_meet" | "microsoft_teams" | "zoom";

export type BotStatus =
  | "queued"
  | "starting"
  | "joining"
  | "recording"
  | "uploading"
  | "processing"
  | "awaiting_transcript"
  | "transcript_ready"
  | "transcript_unavailable"
  | "completed"
  | "failed";

export type SentimentLabel = "positive" | "neutral" | "negative";

export interface SentimentScore {
  label: SentimentLabel;
  score: number;
}

export interface SentimentMoment {
  startTime: number;
  endTime: number;
  label: SentimentLabel;
  score: number;
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

export interface Participant {
  name: string;
  source?: string;
  // Optional org/role label sourced from calendar metadata (Google/Teams)
  // when available. Rendered in transcript exports as "Name (Company)".
  company?: string;
}

// AI-generated topic chapter / bookmark. startTime is in seconds from the
// meeting start; matches the diarizedTranscript segment timestamps so the
// player can seek to it directly.
export interface MeetingChapter {
  title: string;
  startTime: number;
}

export type MomPriority = "high" | "medium" | "low";
export type MomTodoPriority = "critical" | "high" | "medium" | "low";
export type MomStatus = "open" | "in_progress" | "planned" | "done";
export type MomRiskSeverity = "amber" | "red";

export interface MomReport {
  executiveSummary: string;
  meetingPurpose?: string;
  keyTakeaways?: { title: string; detail: string }[];
  toneBreakdown: { positive: number; neutral: number; concerns: number };
  notableQuotes: { text: string; speaker: string; company?: string }[];
  positives: { title: string; detail: string }[];
  concerns: { title: string; detail: string }[];
  momSections: { index: number; tag: string; topic: string; body: string }[];
  actionItems: {
    task: string;
    detail?: string;
    owners?: string[];
    owner?: string;
    due?: string;
    priority?: MomPriority;
    status?: MomStatus;
  }[];
  topTodos: {
    title: string;
    detail: string;
    owner?: string;
    priority?: MomTodoPriority;
    due?: string;
  }[];
  risks: { severity: MomRiskSeverity; title: string; detail: string; owner?: string }[];
  nextSteps: { period: string; title: string; detail: string }[];
  attendees: { name: string; role?: string; initials?: string }[];
  generatedAt: string;
  source: "ai" | "ai_error" | "ai_returned_empty" | "fallback";
  generationError?: string;
}

export interface ParticipantTimelineEntry {
  name: string;
  joinTime: string;
  leaveTime?: string | null;
  firstSeen?: string;
  lastSeen?: string;
}

export interface CaptionTimelineEntry {
  speaker?: string;
  text: string;
  time: string;
  source: "ui_caption";
}

export type MeetingLogLevel = "debug" | "info" | "warn" | "error";

// One entry of the worker's internal pipeline log. The meeting detail
// endpoint returns only the LATEST entry (meetingLogs: [last]) so the UI can
// caption what the pipeline is doing right now while a session is in flight;
// /api/meetings/:id/logs serves the full history.
export interface MeetingLogEntry {
  time: string;
  level: MeetingLogLevel;
  phase: string;
  event: string;
  message: string;
  status?: BotStatus;
  metadata?: Record<string, unknown>;
}

export interface DiarizedTranscriptSegment {
  speaker: string;
  text: string;
  startTime: number;
  endTime: number;
  confidence?: number;
  clusterId?: string;
  sentiment?: SentimentScore;
}

export interface ActionItem {
  task: string;
  assignee?: string | null;
}

export interface MeetingListItem {
  sessionId: string;
  platform: BotPlatform;
  meetingUrl: string;
  meetingName?: string;
  status: BotStatus;
  participants: Participant[];
  summary: string;
  transcriptionProvider?: string;
  meetingLanguage?: string;
  actionItems: ActionItem[];
  recordingUrl?: string;
  thumbnailUrl?: string;
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
  sentimentSummary?: { overall: SentimentScore };
}

export interface MeetingListResponse {
  items: MeetingListItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface Meeting {
  sessionId: string;
  platform: BotPlatform;
  meetingUrl: string;
  meetingName?: string;
  status: BotStatus;
  participants: Participant[];
  participantsTimeline: ParticipantTimelineEntry[];
  captionsTimeline: CaptionTimelineEntry[];
  diarizedTranscript: DiarizedTranscriptSegment[];
  transcriptText: string;
  transcriptionProvider?: string;
  meetingLanguage?: string;
  summary: string;
  chapters?: MeetingChapter[];
  actionItems: ActionItem[];
  sentimentSummary?: SentimentSummary;
  recordingUrl?: string;
  thumbnailUrl?: string;
  momReport?: MomReport;
  // Only the latest pipeline log entry (see MeetingLogEntry).
  meetingLogs?: MeetingLogEntry[];
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
}
