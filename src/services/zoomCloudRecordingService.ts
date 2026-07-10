import { env } from "../config/env";
import { cfgString } from "../config/runtimeConfig";
import { delay } from "../utils/async";
import type { CaptionTimelineEntry, DiarizedTranscriptSegment, Participant, ParticipantTimelineEntry } from "../types/meeting";
import type { Logger } from "pino";

interface ZoomTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

interface ZoomMeeting {
  id: number | string;
  uuid?: string;
  topic?: string;
  start_time?: string;
  duration?: number;
  host_id?: string;
  host_email?: string;
  join_url?: string;
}

interface ZoomRecordingFile {
  id?: string;
  meeting_id?: string;
  recording_type?: string;
  download_url?: string;
  file_type?: string;
  status?: string;
  recording_start?: string;
  recording_end?: string;
  file_extension?: string;
}

interface ZoomRecordingResponse {
  id?: string;
  uuid?: string;
  topic?: string;
  start_time?: string;
  duration?: number;
  recording_files?: ZoomRecordingFile[];
  participant_audio_files?: ZoomRecordingFile[];
}

interface ParsedVttSegment {
  speaker: string;
  text: string;
  startSeconds: number;
  endSeconds: number;
}

export interface ZoomCloudTranscriptResult {
  meeting: ZoomMeeting;
  recording: ZoomRecordingResponse;
  transcriptFile: ZoomRecordingFile;
  rawVtt: string;
  participants: Participant[];
  participantsTimeline: ParticipantTimelineEntry[];
  captionsTimeline: CaptionTimelineEntry[];
  diarizedTranscript: DiarizedTranscriptSegment[];
  transcriptText: string;
  startedAt: Date;
  endedAt: Date;
}

export interface ZoomTranscriptPendingResult {
  meeting: ZoomMeeting;
  attempts: number;
  firstPollAt: Date;
  lastPollAt: Date;
  pendingDurationMs: number;
}

export type ZoomTranscriptCollectionResult =
  | { status: "ready"; result: ZoomCloudTranscriptResult }
  | { status: "pending"; pending: ZoomTranscriptPendingResult };

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

export class ZoomCloudRecordingService {
  private cachedToken: CachedToken | undefined;

  constructor(private readonly logger: Logger) {
    const missing = [
      ["ZOOM_ACCOUNT_ID", cfgString("ZOOM_ACCOUNT_ID")],
      ["ZOOM_CLIENT_ID", cfgString("ZOOM_CLIENT_ID")],
      ["ZOOM_CLIENT_SECRET", cfgString("ZOOM_CLIENT_SECRET")]
    ]
      .filter(([, value]) => !value)
      .map(([key]) => key);
    if (missing.length > 0) {
      throw new Error(`Zoom Cloud Recording flow is not configured. Missing: ${missing.join(", ")}`);
    }
  }

  async collectTranscript(meetingUrl: string): Promise<ZoomTranscriptCollectionResult> {
    const meetingId = extractZoomMeetingId(meetingUrl);
    if (!meetingId) {
      throw new Error(`Zoom Cloud Recording flow could not extract meeting id from URL: ${meetingUrl}`);
    }
    return this.collectTranscriptForMeetingId(meetingId);
  }

  async collectTranscriptForMeetingId(meetingId: string): Promise<ZoomTranscriptCollectionResult> {
    const polled = await this.waitForRecordingTranscript(meetingId);
    if (!polled.transcriptFile || !polled.recording) {
      return {
        status: "pending",
        pending: {
          meeting: polled.meeting ?? { id: meetingId },
          attempts: polled.attempts,
          firstPollAt: polled.firstPollAt,
          lastPollAt: polled.lastPollAt,
          pendingDurationMs: polled.pendingDurationMs
        }
      };
    }

    const rawVtt = await this.downloadTranscriptVtt(polled.transcriptFile);
    const parsed = parseZoomVtt(rawVtt);
    if (parsed.length === 0) {
      throw new Error("Zoom Cloud Recording transcript was downloaded, but no transcript segments were parsed");
    }

    const recording = polled.recording;
    const recordingStart = polled.transcriptFile.recording_start ?? recording.start_time;
    const recordingEnd = polled.transcriptFile.recording_end;
    const startedAt = recordingStart ? new Date(recordingStart) : new Date();
    const lastEnd = parsed.at(-1)?.endSeconds ?? 0;
    const endedAt = recordingEnd
      ? new Date(recordingEnd)
      : new Date(startedAt.getTime() + Math.max(lastEnd, 1) * 1000);

    const firstStart = parsed[0]?.startSeconds ?? 0;
    const participants = buildParticipants(parsed);
    const participantsTimeline: ParticipantTimelineEntry[] = participants.map((participant) => ({
      name: participant.name,
      joinTime: startedAt,
      leaveTime: endedAt
    }));

    const captionsTimeline: CaptionTimelineEntry[] = parsed.map((segment) => ({
      speaker: segment.speaker,
      text: segment.text,
      time: new Date(startedAt.getTime() + Math.max(segment.startSeconds - firstStart, 0) * 1000),
      source: "ui_caption"
    }));

    const diarizedTranscript: DiarizedTranscriptSegment[] = parsed.map((segment) => ({
      speaker: segment.speaker,
      text: segment.text,
      startTime: segment.startSeconds,
      endTime: segment.endSeconds,
      confidence: 1,
      clusterId: segment.speaker
    }));

    const transcriptText = parsed.map((segment) => `${segment.speaker}: ${segment.text}`).join("\n");

    const result: ZoomCloudTranscriptResult = {
      meeting: polled.meeting!,
      recording,
      transcriptFile: polled.transcriptFile,
      rawVtt,
      participants,
      participantsTimeline,
      captionsTimeline,
      diarizedTranscript,
      transcriptText,
      startedAt,
      endedAt
    };
    return { status: "ready", result };
  }

  private async waitForRecordingTranscript(meetingId: string): Promise<{
    meeting?: ZoomMeeting;
    recording?: ZoomRecordingResponse;
    transcriptFile?: ZoomRecordingFile;
    attempts: number;
    firstPollAt: Date;
    lastPollAt: Date;
    pendingDurationMs: number;
  }> {
    const deadline = Date.now() + env.ZOOM_TRANSCRIPT_TIMEOUT_MS;
    const firstPollAt = new Date();
    let lastPollAt = firstPollAt;
    let attempts = 0;
    let latestMeeting: ZoomMeeting | undefined;
    let latestRecording: ZoomRecordingResponse | undefined;

    while (Date.now() < deadline) {
      attempts += 1;
      lastPollAt = new Date();
      try {
        const recording = await this.fetchRecordings(meetingId);
        latestRecording = recording;
        latestMeeting = {
          id: recording.id ?? meetingId,
          uuid: recording.uuid,
          topic: recording.topic,
          start_time: recording.start_time,
          duration: recording.duration
        };
        const transcriptFile = findCompletedTranscriptFile(recording);
        if (transcriptFile) {
          this.logger.info(
            { meetingId, transcriptFileId: transcriptFile.id, attempt: attempts },
            "zoom cloud transcript found"
          );
          return {
            meeting: latestMeeting,
            recording,
            transcriptFile,
            attempts,
            firstPollAt,
            lastPollAt,
            pendingDurationMs: lastPollAt.getTime() - firstPollAt.getTime()
          };
        }
        this.logger.info(
          {
            meetingId,
            attempt: attempts,
            recording_found: true,
            transcript_found: false,
            transcript_pending_duration: Date.now() - firstPollAt.getTime()
          },
          "zoom cloud transcript not available yet"
        );
      } catch (error) {
        if (!isRetryableZoomError(error)) throw error;
        this.logger.warn(
          { meetingId, attempt: attempts, err: error },
          "zoom cloud transcript poll failed transiently; retrying"
        );
      }
      await delay(env.ZOOM_TRANSCRIPT_POLL_INTERVAL_MS);
    }

    return {
      meeting: latestMeeting,
      recording: latestRecording,
      attempts,
      firstPollAt,
      lastPollAt,
      pendingDurationMs: lastPollAt.getTime() - firstPollAt.getTime()
    };
  }

  private async fetchRecordings(meetingId: string): Promise<ZoomRecordingResponse> {
    // Zoom's GET /meetings/{meetingId}/recordings accepts a numeric meeting id
    // OR a double-URL-encoded UUID (if it starts with `/` or `//`). We always
    // pass the value as-is; callers should provide the numeric id when they
    // have it.
    const path = `/meetings/${encodeURIComponent(meetingId)}/recordings`;
    return this.apiRequest<ZoomRecordingResponse>("get cloud recording", path);
  }

  private async downloadTranscriptVtt(file: ZoomRecordingFile): Promise<string> {
    if (!file.download_url) {
      throw new Error("Zoom transcript file has no download_url");
    }
    const accessToken = await this.getAccessToken();
    const response = await fetch(`${file.download_url}?access_token=${encodeURIComponent(accessToken)}`, {
      method: "GET",
      headers: { Accept: "text/vtt" }
    });
    if (!response.ok) {
      throw new Error(
        `Zoom Cloud Recording transcript download failed: HTTP ${response.status} ${response.statusText}`
      );
    }
    const text = await response.text();
    this.logger.info({ transcriptFileId: file.id, bytes: Buffer.byteLength(text, "utf8") }, "zoom transcript content downloaded");
    return text;
  }

  private async apiRequest<T>(operation: string, path: string): Promise<T> {
    const accessToken = await this.getAccessToken();
    const url = `${env.ZOOM_API_BASE_URL}${path}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const error = new Error(
        `Zoom API ${operation} failed: HTTP ${response.status} ${response.statusText} ${body.slice(0, 240)}`
      ) as Error & { statusCode?: number };
      error.statusCode = response.status;
      this.logger.error({ operation, statusCode: response.status, body: body.slice(0, 240) }, "zoom api request failed");
      throw error;
    }
    return (await response.json()) as T;
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 30_000) {
      return this.cachedToken.accessToken;
    }
    const credentials = Buffer.from(`${cfgString("ZOOM_CLIENT_ID")}:${cfgString("ZOOM_CLIENT_SECRET")}`).toString("base64");
    const url = `${env.ZOOM_OAUTH_BASE_URL}/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(cfgString("ZOOM_ACCOUNT_ID")!)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Zoom OAuth token request failed: HTTP ${response.status} ${response.statusText} ${body.slice(0, 240)}`);
    }
    const token = (await response.json()) as ZoomTokenResponse;
    if (!token.access_token) {
      throw new Error("Zoom OAuth token response did not contain access_token");
    }
    this.cachedToken = {
      accessToken: token.access_token,
      expiresAt: Date.now() + Math.max(token.expires_in - 30, 60) * 1000
    };
    return token.access_token;
  }
}

export function isPermanentZoomError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/HTTP 401|HTTP 403|invalid_grant|invalid_client|HTTP 404/i.test(message)) return true;
  if (/could not extract meeting id/i.test(message)) return true;
  if (/not configured/i.test(message)) return true;
  return false;
}

function isRetryableZoomError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch failed|network|socket|timeout|econnreset|etimedout|enotfound|eai_again/i.test(message)) return true;
  const statusCode = (error as { statusCode?: number } | undefined)?.statusCode;
  if (statusCode && [429, 500, 502, 503, 504].includes(statusCode)) return true;
  // Treat 404 / "meeting not found" as retryable while transcript is still
  // being generated — Zoom returns 404 briefly between meeting end and the
  // recording being published.
  if (statusCode === 404) return true;
  return false;
}

export function extractZoomMeetingId(meetingUrl: string): string | undefined {
  // Supported shapes:
  //   https://zoom.us/j/<id>?pwd=...
  //   https://<region>.zoom.us/j/<id>?pwd=...
  //   https://zoom.us/wc/<id>/start
  //   https://zoom.us/s/<id>
  //   https://zoom.us/my/<vanity>?confno=<id>
  //   zoommtg://zoom.us/join?confno=<id>&...
  try {
    const trimmed = meetingUrl.trim();
    const urlLike = trimmed.replace(/^zoommtg:\/\//i, "https://");
    const url = new URL(urlLike);
    const segments = url.pathname.split("/").filter(Boolean);
    const knownPrefixes = ["j", "wc", "s"];
    for (let index = 0; index < segments.length; index += 1) {
      if (knownPrefixes.includes(segments[index].toLowerCase())) {
        const candidate = segments[index + 1];
        if (candidate && /^\d{8,12}$/.test(candidate)) return candidate;
      }
    }
    const confno = url.searchParams.get("confno");
    if (confno && /^\d{8,12}$/.test(confno)) return confno;
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segment = segments[index];
      if (/^\d{8,12}$/.test(segment)) return segment;
    }
  } catch {
    // ignore — fall through to regex extraction below
  }
  const match = meetingUrl.match(/\b(\d{8,12})\b/);
  return match?.[1];
}

function findCompletedTranscriptFile(recording: ZoomRecordingResponse): ZoomRecordingFile | undefined {
  const files = recording.recording_files ?? [];
  for (const file of files) {
    if (!file.download_url) continue;
    if ((file.status ?? "completed").toLowerCase() !== "completed") continue;
    const recordingType = (file.recording_type ?? "").toLowerCase();
    const fileType = (file.file_type ?? "").toLowerCase();
    const fileExtension = (file.file_extension ?? "").toLowerCase();
    if (recordingType === "audio_transcript") return file;
    if (recordingType === "closed_caption" || recordingType === "captions") return file;
    if (fileType === "transcript" || fileExtension === "vtt") return file;
  }
  return undefined;
}

function parseZoomVtt(vtt: string): ParsedVttSegment[] {
  const blocks = vtt
    .replace(/^﻿/, "")
    .split(/\r?\n\r?\n/g)
    .map((block) => block.trim())
    .filter(Boolean);
  const segments: ParsedVttSegment[] = [];

  for (const block of blocks) {
    if (/^WEBVTT/i.test(block) || /^NOTE\b/i.test(block)) continue;
    const lines = block.split(/\r?\n/g).map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;

    const [startRaw, endRaw] = lines[timingIndex].split("-->").map((part) => part.trim().split(/\s+/)[0]);
    const startSeconds = parseVttTimestamp(startRaw);
    const endSeconds = parseVttTimestamp(endRaw);
    const payload = lines.slice(timingIndex + 1).join(" ").trim();
    if (!payload) continue;

    // Zoom VTT formats:
    //   "<v Alice>Hello there</v>"          (WebVTT voice tag)
    //   "Alice: Hello there"                 (Zoom's audio_transcript style)
    //   "Hello there"                        (no speaker — fall back to "Speaker")
    let speaker = "Speaker";
    let text = payload;
    const voiceMatch = payload.match(/<v(?:\s+([^>]+))?>([\s\S]*?)<\/v>/i);
    if (voiceMatch) {
      speaker = cleanVttText(voiceMatch[1] ?? "Speaker") || "Speaker";
      text = cleanVttText(voiceMatch[2] ?? payload);
    } else {
      const colonMatch = payload.match(/^([^:\n][^:\n]{0,60}?):\s+(.+)$/);
      if (colonMatch) {
        speaker = cleanVttText(colonMatch[1]) || "Speaker";
        text = cleanVttText(colonMatch[2]);
      } else {
        text = cleanVttText(payload);
      }
    }
    if (!text) continue;

    segments.push({ speaker, text, startSeconds, endSeconds });
  }

  return segments;
}

function parseVttTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const parts = value.replace(",", ".").split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(value) || 0;
}

function cleanVttText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function buildParticipants(segments: ParsedVttSegment[]): Participant[] {
  const names = new Set<string>();
  for (const segment of segments) {
    if (segment.speaker && !/^speaker$/i.test(segment.speaker)) names.add(segment.speaker);
  }
  return [...names].map((name) => ({ name, source: "caption_label" }));
}
