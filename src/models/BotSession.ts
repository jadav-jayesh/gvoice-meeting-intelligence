import { Schema, model, Types, type HydratedDocument } from "mongoose";
import {
  botPlatforms,
  botStatuses,
  sentimentLabels,
  type ActionItem,
  type BotPlatform,
  type BotStatus,
  type CaptionTimelineEntry,
  type DiarizedTranscriptSegment,
  type MeetingChapter,
  type MeetingLogEntry,
  type MomReport,
  type Participant,
  type ParticipantTimelineEntry,
  type SentimentSummary,
  type TranscriptPollingState
} from "../types/meeting";

export interface BotSession {
  sessionId: string;
  // The owner — the user who first created/triggered this session. Drives
  // "manage" semantics and display. Unchanged by sharing.
  userId?: Types.ObjectId;
  // Everyone who can VIEW this meeting: the owner plus every shared joiner
  // (other invited users whose connected calendar surfaced the same meeting
  // instance, and registered users who manually joined the same live link).
  // Visibility queries filter on this single field (no $or) so Cosmos can serve
  // the list's filter+sort from one compound index. Always contains userId.
  accessUserIds: Types.ObjectId[];
  platform: BotPlatform;
  meetingUrl: string;
  meetingName?: string;
  // The title from the calendar event that scheduled this auto-join. Set once
  // at creation and never overwritten, so it stays the authoritative
  // human-given title even after the bot scrapes a page title or the AI
  // generates a short title. Absent for manually-joined sessions.
  scheduledMeetingTitle?: string;
  meetingPasscode?: string;
  webhookUrl?: string;
  // How this session was created: "manual" (user pasted a link) or "calendar"
  // (auto-join scheduled from a connected calendar event).
  source?: "manual" | "calendar";
  // Legacy per-user calendar key (`userId#dedupeKey#startISO`). No longer
  // written — superseded by meetingInstanceKey. Kept (with its unique index) so
  // pre-existing rows are untouched.
  calendarEventKey?: string;
  // Cross-user per-meeting-instance key (`dedupeKey(joinUrl)#startISO`, NO
  // userId). Guarantees ONE bot per live meeting no matter how many invited
  // users' calendars surface it. Unique+sparse so manual sessions are unaffected
  // and the second user's poll loses the race cleanly (E11000).
  meetingInstanceKey?: string;
  // Normalized join-url key (dedupeKey(joinUrl)). Set on every session so the
  // manual "Join Meeting" path can detect an already-live bot for the same link
  // and attach to it instead of spawning a duplicate.
  meetingDedupeKey?: string;
  // Scheduled meeting end (calendar sessions only). The precise "is this bot
  // still live?" signal for manual-join dedup — beats an arbitrary time window.
  scheduledEndAt?: Date;
  status: BotStatus;
  participants: Participant[];
  participantsTimeline: ParticipantTimelineEntry[];
  captionsTimeline: CaptionTimelineEntry[];
  diarizedTranscript: DiarizedTranscriptSegment[];
  transcriptText: string;
  // Which engine produced the transcript ("whisper" | "sarvam" | "azure" |
  // "mock") and the detected meeting language ("en" | "hi" | "gu" | "mixed").
  // Optional/additive: legacy sessions and graph/cloud transcript paths leave
  // them unset, and the UI renders "—" in that case.
  transcriptionProvider?: string;
  meetingLanguage?: string;
  summary: string;
  chapters: MeetingChapter[];
  actionItems: ActionItem[];
  sentimentSummary?: SentimentSummary;
  meetingLogs: MeetingLogEntry[];
  teamsOnlineMeetingId?: string;
  teamsTranscriptId?: string;
  zoomMeetingId?: string;
  zoomRecordingId?: string;
  zoomTranscriptFileId?: string;
  transcriptPolling?: TranscriptPollingState;
  momReport?: MomReport;
  recordingUrl?: string;
  thumbnailUrl?: string;
  startedAt?: Date;
  endedAt?: Date;
  errorMessage?: string;
  // Public share link. When shareEnabled is true, anyone holding shareToken can
  // view a read-only, sanitized copy of this meeting at /share/<token> with no
  // login. The token is an unguessable random string; disabling share (or
  // clearing the token) instantly kills the public link.
  shareToken?: string;
  shareEnabled?: boolean;
  sharedAt?: Date;
  sharedBy?: Types.ObjectId;
  // Populated by Mongoose `timestamps: true`.
  createdAt?: Date;
  updatedAt?: Date;
}

export type BotSessionDocument = HydratedDocument<BotSession>;

const participantSchema = new Schema<Participant>(
  {
    name: { type: String, required: true },
    source: { type: String, enum: ["participant_panel", "caption_label", "diarization_cluster"] },
    company: { type: String }
  },
  { _id: false }
);

const participantTimelineSchema = new Schema<ParticipantTimelineEntry>(
  {
    name: { type: String, required: true },
    joinTime: { type: Date, required: true },
    leaveTime: { type: Date },
    firstSeen: { type: Date },
    lastSeen: { type: Date }
  },
  { _id: false }
);

const captionSchema = new Schema<CaptionTimelineEntry>(
  {
    speaker: { type: String },
    text: { type: String, required: true },
    time: { type: Date, required: true },
    source: { type: String, enum: ["ui_caption"], default: "ui_caption", required: true }
  },
  { _id: false }
);

const sentimentScoreSchema = new Schema(
  {
    label: { type: String, enum: sentimentLabels, required: true },
    score: { type: Number, required: true }
  },
  { _id: false }
);

const diarizedSegmentSchema = new Schema<DiarizedTranscriptSegment>(
  {
    speaker: { type: String, required: true },
    text: { type: String, required: true },
    startTime: { type: Number, required: true },
    endTime: { type: Number, required: true },
    confidence: { type: Number },
    clusterId: { type: String },
    sentiment: { type: sentimentScoreSchema }
  },
  { _id: false }
);

const sentimentMomentSchema = new Schema(
  {
    startTime: { type: Number, required: true },
    endTime: { type: Number, required: true },
    label: { type: String, enum: sentimentLabels, required: true },
    score: { type: Number, required: true },
    quote: { type: String },
    speaker: { type: String }
  },
  { _id: false }
);

const perSpeakerSentimentSchema = new Schema(
  {
    speaker: { type: String, required: true },
    label: { type: String, enum: sentimentLabels, required: true },
    score: { type: Number, required: true },
    segmentCount: { type: Number, required: true }
  },
  { _id: false }
);

const sentimentSummarySchema = new Schema<SentimentSummary>(
  {
    overall: { type: sentimentScoreSchema, required: true },
    perSpeaker: { type: [perSpeakerSentimentSchema], default: [] },
    topMoments: { type: [sentimentMomentSchema], default: [] }
  },
  { _id: false }
);

const actionItemSchema = new Schema<ActionItem>(
  {
    task: { type: String, required: true },
    assignee: { type: String }
  },
  { _id: false }
);

const chapterSchema = new Schema<MeetingChapter>(
  {
    title: { type: String, required: true },
    startTime: { type: Number, required: true }
  },
  { _id: false }
);

const momReportSchema = new Schema<MomReport>(
  {
    executiveSummary: { type: String, default: "" },
    meetingPurpose: { type: String },
    keyTakeaways: {
      type: [new Schema({ title: String, detail: String }, { _id: false })],
      default: []
    },
    toneBreakdown: {
      type: new Schema(
        { positive: Number, neutral: Number, concerns: Number },
        { _id: false }
      ),
      default: () => ({ positive: 0, neutral: 0, concerns: 0 })
    },
    notableQuotes: {
      type: [new Schema({ text: String, speaker: String, company: String }, { _id: false })],
      default: []
    },
    positives: {
      type: [new Schema({ title: String, detail: String }, { _id: false })],
      default: []
    },
    concerns: {
      type: [new Schema({ title: String, detail: String }, { _id: false })],
      default: []
    },
    momSections: {
      type: [
        new Schema(
          { index: Number, tag: String, topic: String, body: String },
          { _id: false }
        )
      ],
      default: []
    },
    actionItems: {
      type: [
        new Schema(
          {
            task: String,
            detail: String,
            owners: { type: [String], default: [] },
            owner: String,
            due: String,
            priority: { type: String, enum: ["high", "medium", "low"] },
            status: { type: String, enum: ["open", "in_progress", "planned", "done"] }
          },
          { _id: false }
        )
      ],
      default: []
    },
    topTodos: {
      type: [
        new Schema(
          { title: String, detail: String, owner: String, priority: String, due: String },
          { _id: false }
        )
      ],
      default: []
    },
    risks: {
      type: [
        new Schema(
          {
            severity: { type: String, enum: ["amber", "red"], required: true },
            title: String,
            detail: String,
            owner: String
          },
          { _id: false }
        )
      ],
      default: []
    },
    nextSteps: {
      type: [
        new Schema({ period: String, title: String, detail: String }, { _id: false })
      ],
      default: []
    },
    attendees: {
      type: [
        new Schema({ name: String, role: String, initials: String }, { _id: false })
      ],
      default: []
    },
    generatedAt: { type: Date, default: Date.now },
    source: { type: String, enum: ["ai", "ai_error", "ai_returned_empty", "fallback"], default: "fallback" },
    generationError: { type: String }
  },
  { _id: false }
);

const meetingLogSchema = new Schema<MeetingLogEntry>(
  {
    time: { type: Date, required: true, default: Date.now, index: true },
    level: { type: String, required: true, enum: ["debug", "info", "warn", "error"], default: "info" },
    phase: {
      type: String,
      required: true,
      enum: ["session", "queue", "browser", "join", "recording", "capture", "upload", "processing", "transcription", "retry", "summary", "webhook", "completion", "failure"]
    },
    event: { type: String, required: true },
    message: { type: String, required: true },
    status: { type: String, enum: botStatuses },
    metadata: { type: Schema.Types.Mixed }
  },
  { _id: false }
);

const transcriptPollingSchema = new Schema<TranscriptPollingState>(
  {
    onlineMeetingId: { type: String },
    transcriptId: { type: String },
    retryCount: { type: Number, required: true, default: 0 },
    pollAttemptCount: { type: Number, required: true, default: 0 },
    firstPollAt: { type: Date },
    lastPollAt: { type: Date },
    nextRetryAt: { type: Date },
    pendingDurationMs: { type: Number },
    lastGraphStatus: { type: Number },
    lastGraphError: { type: String },
    finalFailureReason: { type: String }
  },
  { _id: false }
);

const botSessionSchema = new Schema<BotSession>(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    // Optional in the schema so the legacy-claim step during first signup can
    // backfill pre-existing rows that were created before ownership existed.
    // New sessions always set this in the bots route handler.
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    accessUserIds: { type: [{ type: Schema.Types.ObjectId, ref: "User" }], default: [] },
    platform: { type: String, required: true, enum: botPlatforms },
    meetingUrl: { type: String, required: true },
    meetingName: { type: String },
    scheduledMeetingTitle: { type: String },
    meetingPasscode: { type: String },
    webhookUrl: { type: String },
    source: { type: String, enum: ["manual", "calendar"], default: "manual" },
    calendarEventKey: { type: String },
    meetingInstanceKey: { type: String },
    meetingDedupeKey: { type: String },
    scheduledEndAt: { type: Date },
    status: { type: String, required: true, enum: botStatuses, default: "queued", index: true },
    participants: { type: [participantSchema], default: [] },
    participantsTimeline: { type: [participantTimelineSchema], default: [] },
    captionsTimeline: { type: [captionSchema], default: [] },
    diarizedTranscript: { type: [diarizedSegmentSchema], default: [] },
    transcriptText: { type: String, default: "" },
    transcriptionProvider: { type: String },
    meetingLanguage: { type: String },
    summary: { type: String, default: "" },
    chapters: { type: [chapterSchema], default: [] },
    actionItems: { type: [actionItemSchema], default: [] },
    sentimentSummary: { type: sentimentSummarySchema },
    meetingLogs: { type: [meetingLogSchema], default: [] },
    teamsOnlineMeetingId: { type: String },
    teamsTranscriptId: { type: String },
    zoomMeetingId: { type: String },
    zoomRecordingId: { type: String },
    zoomTranscriptFileId: { type: String },
    transcriptPolling: { type: transcriptPollingSchema },
    momReport: { type: momReportSchema },
    recordingUrl: { type: String },
    thumbnailUrl: { type: String },
    startedAt: { type: Date },
    endedAt: { type: Date },
    errorMessage: { type: String },
    shareToken: { type: String },
    shareEnabled: { type: Boolean, default: false },
    sharedAt: { type: Date },
    sharedBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

botSessionSchema.index({ platform: 1, status: 1, createdAt: -1 });
// The meetings list does find({ userId }).sort({ createdAt: -1 }). Cosmos DB's
// Mongo API refuses to sort on a field it can't serve from an index (unlike
// native Mongo, which sorts in memory), so this compound index is required or
// /api/meetings 500s in production.
botSessionSchema.index({ userId: 1, createdAt: -1 });
// Shared-visibility list query: find({ accessUserIds: uid }).sort({ createdAt: -1 }).
// Multikey filter + compound sort in ONE index so Cosmos serves it without the
// "can't sort on an unindexed field" 500 (same quirk that needs userId+createdAt).
botSessionSchema.index({ accessUserIds: 1, createdAt: -1 });
// One session per calendar-event instance (manual sessions leave the key unset).
botSessionSchema.index({ calendarEventKey: 1 }, { unique: true, sparse: true });
// One bot per live meeting instance across ALL users (the cross-user dedup that
// collapses every invitee's calendar to a single bot). Unique+sparse: the race
// loser gets E11000 instead of a duplicate bot.
botSessionSchema.index({ meetingInstanceKey: 1 }, { unique: true, sparse: true });
// Manual-join lookup: "is a bot already live for this link?" — find active
// sessions by normalized join-url key, newest first.
botSessionSchema.index({ meetingDedupeKey: 1, status: 1, createdAt: -1 });
// Public share-link lookup: find one session by its token. Sparse (only shared
// sessions are indexed). NOT unique: Cosmos DB's Mongo API can't build a unique
// index on a non-empty collection, and the 24-byte (192-bit) random token makes
// a collision astronomically unlikely, so we rely on entropy rather than a DB
// constraint.
botSessionSchema.index({ shareToken: 1 }, { sparse: true });
botSessionSchema.index({ sessionId: 1, "meetingLogs.time": 1 });
botSessionSchema.index({ status: 1, "transcriptPolling.nextRetryAt": 1 });

export const BotSessionModel = model<BotSession>("BotSession", botSessionSchema);
