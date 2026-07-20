import crypto from "node:crypto";
import { Types } from "mongoose";
import { BotSessionModel } from "../models/BotSession";
import { signBlobReadUrl } from "../storage/azureBlobStorage";
import { env } from "../config/env";

// Public share links let anyone holding an unguessable token view a read-only,
// sanitized copy of a meeting with no login. Enabling generates the token (once)
// and flips shareEnabled; disabling flips it back so the same link stops working
// immediately. Deleting the meeting removes the token with it.

export type ShareManageResult =
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "ok"; enabled: boolean; token: string | null; url: string | null };

function generateShareToken(): string {
  // 24 random bytes → 32-char base64url. Unguessable; the only guard on the
  // public endpoint, so entropy matters.
  return crypto.randomBytes(24).toString("base64url");
}

export function buildShareUrl(token: string): string {
  const base = (env.WEB_ORIGIN || "").replace(/\/+$/, "");
  return `${base}/share/${token}`;
}

// A requester may manage sharing if they are an admin, or the meeting is in
// their access set (owner or shared viewer). Returns the hydrated doc or null.
async function findManageable(sessionId: string, requesterId: string, isAdmin: boolean) {
  const filter = isAdmin ? { sessionId } : { sessionId, accessUserIds: requesterId };
  return BotSessionModel.findOne(filter);
}

async function manageResult(sessionId: string): Promise<ShareManageResult> {
  // Called only when findManageable returned null — distinguish "doesn't exist"
  // (404) from "exists but not yours" (403) without leaking content either way.
  const exists = await BotSessionModel.exists({ sessionId });
  return exists ? { status: "forbidden" } : { status: "not_found" };
}

export async function enableShare(sessionId: string, requesterId: string, isAdmin: boolean): Promise<ShareManageResult> {
  const doc = await findManageable(sessionId, requesterId, isAdmin);
  if (!doc) return manageResult(sessionId);
  if (!doc.shareToken) doc.shareToken = generateShareToken();
  doc.shareEnabled = true;
  doc.sharedAt = new Date();
  doc.sharedBy = new Types.ObjectId(requesterId);
  await doc.save();
  return { status: "ok", enabled: true, token: doc.shareToken, url: buildShareUrl(doc.shareToken) };
}

export async function disableShare(sessionId: string, requesterId: string, isAdmin: boolean): Promise<ShareManageResult> {
  const doc = await findManageable(sessionId, requesterId, isAdmin);
  if (!doc) return manageResult(sessionId);
  doc.shareEnabled = false;
  await doc.save();
  return { status: "ok", enabled: false, token: null, url: null };
}

export interface PublicMeeting {
  token: string;
  meetingName?: string;
  platform: string;
  status: string;
  meetingLanguage?: string;
  transcriptionProvider?: string;
  startedAt?: Date;
  endedAt?: Date;
  createdAt?: Date;
  participants: Array<{ name: string }>;
  summary: string;
  chapters: unknown[];
  actionItems: unknown[];
  sentimentSummary?: unknown;
  diarizedTranscript: unknown[];
  transcriptText: string;
  momReport?: unknown;
  hasRecording: boolean;
  recordingUrl?: string;
  thumbnailUrl?: string;
}

// Whitelist ONLY presentation data. Never expose internal/ownership fields
// (userId, accessUserIds, meetingUrl/passcode, webhookUrl, meetingLogs, calendar
// keys, the shareToken itself, cloud/transcript ids). The recording is served
// through a token-scoped proxy so revoking the link kills video access too.
export async function getSharedMeeting(token: string): Promise<PublicMeeting | null> {
  if (!token) return null;
  const s = await BotSessionModel.findOne({ shareToken: token, shareEnabled: true }).lean();
  if (!s) return null;
  return {
    token,
    meetingName: s.meetingName,
    platform: s.platform,
    status: s.status,
    meetingLanguage: s.meetingLanguage,
    transcriptionProvider: s.transcriptionProvider,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    createdAt: s.createdAt,
    participants: (s.participants ?? []).map((p) => ({ name: p.name })),
    summary: s.summary ?? "",
    chapters: s.chapters ?? [],
    actionItems: s.actionItems ?? [],
    sentimentSummary: s.sentimentSummary,
    diarizedTranscript: s.diarizedTranscript ?? [],
    transcriptText: s.transcriptText ?? "",
    momReport: s.momReport,
    hasRecording: Boolean(s.recordingUrl),
    recordingUrl: s.recordingUrl ? `/api/public/meetings/${token}/recording` : undefined,
    thumbnailUrl: s.thumbnailUrl ? signBlobReadUrl(s.thumbnailUrl) : undefined
  };
}

// Resolve the raw (private) recording blob URL for a shared token, or null if
// the token is invalid/disabled or there's no recording. Used by the public
// recording proxy so a revoked link can no longer stream the video.
export async function getSharedRecordingUrl(token: string): Promise<string | null> {
  if (!token) return null;
  const s = await BotSessionModel.findOne(
    { shareToken: token, shareEnabled: true },
    { recordingUrl: 1 }
  ).lean();
  return s?.recordingUrl ?? null;
}
