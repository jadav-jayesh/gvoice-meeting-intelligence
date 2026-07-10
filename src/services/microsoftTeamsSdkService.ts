import { Client } from "@microsoft/microsoft-graph-client";
import { ResponseType } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";
import { ClientSecretCredential } from "@azure/identity";
import { env } from "../config/env";
import { cfgString } from "../config/runtimeConfig";
import { delay } from "../utils/async";
import type { CaptionTimelineEntry, DiarizedTranscriptSegment, Participant, ParticipantTimelineEntry } from "../types/meeting";
import type { Logger } from "pino";

interface OnlineMeetingCollectionResponse {
  value?: GraphOnlineMeeting[];
}

interface GraphOnlineMeeting {
  id: string;
  subject?: string;
  startDateTime?: string;
  endDateTime?: string;
  joinWebUrl?: string;
}

interface CallTranscriptCollectionResponse {
  value?: GraphCallTranscript[];
}

interface GraphCallTranscript {
  id: string;
  meetingId?: string;
  createdDateTime?: string;
  endDateTime?: string;
  transcriptContentUrl?: string;
}

interface ParsedVttSegment {
  speaker: string;
  text: string;
  startSeconds: number;
  endSeconds: number;
}

interface TeamsJoinContext {
  Tid?: string;
  Oid?: string;
}

export interface TeamsSdkTranscriptResult {
  meeting: GraphOnlineMeeting;
  transcript: GraphCallTranscript;
  rawVtt: string;
  participants: Participant[];
  participantsTimeline: ParticipantTimelineEntry[];
  captionsTimeline: CaptionTimelineEntry[];
  diarizedTranscript: DiarizedTranscriptSegment[];
  transcriptText: string;
  startedAt: Date;
  endedAt: Date;
}

export interface TeamsTranscriptPendingResult {
  meeting: GraphOnlineMeeting;
  attempts: number;
  firstPollAt: Date;
  lastPollAt: Date;
  pendingDurationMs: number;
}

export type TeamsTranscriptCollectionResult =
  | { status: "ready"; result: TeamsSdkTranscriptResult }
  | { status: "pending"; pending: TeamsTranscriptPendingResult };

export class MicrosoftTeamsSdkService {
  private readonly graphClient: Client;

  constructor(private readonly logger: Logger) {
    const tenantId = env.TEAMS_GRAPH_TENANT_ID ?? env.TEAMS_BOT_TENANT_ID;
    const clientId = env.TEAMS_GRAPH_CLIENT_ID ?? env.TEAMS_BOT_APP_ID;
    const clientSecret = cfgString("TEAMS_GRAPH_CLIENT_SECRET") ?? env.TEAMS_BOT_APP_PASSWORD;
    const missing = [
      ["TEAMS_GRAPH_TENANT_ID or TEAMS_BOT_TENANT_ID", tenantId],
      ["TEAMS_GRAPH_CLIENT_ID or TEAMS_BOT_APP_ID", clientId],
      ["TEAMS_GRAPH_CLIENT_SECRET or TEAMS_BOT_APP_PASSWORD", clientSecret],
      ["TEAMS_GRAPH_USER_ID", env.TEAMS_GRAPH_USER_ID]
    ]
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (missing.length > 0) {
      throw new Error(`Microsoft Teams SDK flow is not configured. Missing: ${missing.join(", ")}`);
    }

    const credential = new ClientSecretCredential(tenantId!, clientId!, clientSecret!);
    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: ["https://graph.microsoft.com/.default"]
    });

    this.graphClient = Client.initWithMiddleware({ authProvider });
  }

  async collectTranscript(meetingUrl: string): Promise<TeamsTranscriptCollectionResult> {
    const meeting = await this.resolveOnlineMeeting(meetingUrl);
    return this.collectTranscriptForMeeting(meeting);
  }

  async collectTranscriptForOnlineMeetingId(onlineMeetingId: string): Promise<TeamsTranscriptCollectionResult> {
    const meeting = await this.getOnlineMeeting(onlineMeetingId);
    return this.collectTranscriptForMeeting(meeting);
  }

  private async collectTranscriptForMeeting(meeting: GraphOnlineMeeting): Promise<TeamsTranscriptCollectionResult> {
    const transcriptResult = await this.waitForTranscript(meeting.id);
    if (!transcriptResult.transcript) {
      return {
        status: "pending",
        pending: {
          meeting,
          attempts: transcriptResult.attempts,
          firstPollAt: transcriptResult.firstPollAt,
          lastPollAt: transcriptResult.lastPollAt,
          pendingDurationMs: transcriptResult.pendingDurationMs
        }
      };
    }

    const transcript = transcriptResult.transcript;
    const rawVtt = await this.downloadTranscriptVtt(meeting.id, transcript.id);
    const parsed = parseTeamsVtt(rawVtt);

    if (parsed.length === 0) {
      throw new Error("Microsoft Teams SDK transcript was downloaded, but no transcript segments were parsed");
    }

    const firstStart = parsed[0]?.startSeconds ?? 0;
    const lastEnd = parsed.at(-1)?.endSeconds ?? firstStart;
    const endedAt = transcript.endDateTime ? new Date(transcript.endDateTime) : meeting.endDateTime ? new Date(meeting.endDateTime) : new Date();
    const startedAt = meeting.startDateTime ? new Date(meeting.startDateTime) : new Date(endedAt.getTime() - Math.max(lastEnd, 1) * 1000);
    const participants = buildParticipants(parsed);
    const participantsTimeline = participants.map((participant) => ({ name: participant.name, joinTime: startedAt, leaveTime: endedAt }));

    const result: TeamsSdkTranscriptResult = {
      meeting,
      transcript,
      rawVtt,
      participants,
      participantsTimeline,
      captionsTimeline: parsed.map((segment) => ({
        speaker: segment.speaker,
        text: segment.text,
        time: new Date(startedAt.getTime() + Math.max(segment.startSeconds - firstStart, 0) * 1000),
        source: "ui_caption"
      })),
      diarizedTranscript: parsed.map((segment) => ({
        speaker: segment.speaker,
        text: segment.text,
        startTime: segment.startSeconds,
        endTime: segment.endSeconds,
        confidence: 1,
        clusterId: segment.speaker
      })),
      transcriptText: parsed.map((segment) => `${segment.speaker}: ${segment.text}`).join("\n"),
      startedAt,
      endedAt
    };

    return { status: "ready", result };
  }

  private async resolveOnlineMeeting(meetingUrl: string): Promise<GraphOnlineMeeting> {
    const joinContext = parseTeamsJoinContext(meetingUrl);
    if (joinContext) {
      this.logger.info({ joinContext, configuredUserId: env.TEAMS_GRAPH_USER_ID }, "teams join URL context parsed");
      if (joinContext.Tid && env.TEAMS_GRAPH_TENANT_ID && joinContext.Tid.toLowerCase() !== env.TEAMS_GRAPH_TENANT_ID.toLowerCase()) {
        throw new Error(
          `Teams meeting tenant ${joinContext.Tid} does not match TEAMS_GRAPH_TENANT_ID ${env.TEAMS_GRAPH_TENANT_ID}`
        );
      }
      if (joinContext.Oid && joinContext.Oid.toLowerCase() !== env.TEAMS_GRAPH_USER_ID!.toLowerCase()) {
        throw new Error(
          `Teams meeting organizer/context Oid ${joinContext.Oid} does not match TEAMS_GRAPH_USER_ID ${env.TEAMS_GRAPH_USER_ID}. ` +
            "Set TEAMS_GRAPH_USER_ID to the organizer Oid and grant the Teams application access policy to that user."
        );
      }
    }

    const endpoint = `/users/${encodeURIComponent(env.TEAMS_GRAPH_USER_ID!)}/onlineMeetings`;
    const response = await this.resolveOnlineMeetingByJoinUrlVariants(endpoint, meetingUrl);

    const meeting = response.value?.[0];
    if (!meeting?.id) {
      throw new Error("Microsoft Teams SDK flow could not resolve onlineMeeting from join URL");
    }

    this.logger.info({ onlineMeetingId: meeting.id, subject: meeting.subject }, "teams sdk online meeting resolved");
    return meeting;
  }

  private async getOnlineMeeting(onlineMeetingId: string): Promise<GraphOnlineMeeting> {
    const endpoint = `/users/${encodeURIComponent(env.TEAMS_GRAPH_USER_ID!)}/onlineMeetings/${encodeURIComponent(onlineMeetingId)}`;
    const meeting = (await this.graphCall("get Teams online meeting", () => this.graphClient.api(endpoint).get())) as GraphOnlineMeeting;
    if (!meeting?.id) throw new Error(`Microsoft Teams online meeting not found: ${onlineMeetingId}`);
    return meeting;
  }

  private async resolveOnlineMeetingByJoinUrlVariants(endpoint: string, meetingUrl: string): Promise<OnlineMeetingCollectionResponse> {
    const attempts = joinWebUrlFilterCandidates(meetingUrl);
    let lastError: unknown;

    for (const attempt of attempts) {
      try {
        const response = (await this.graphCall(`resolve online meeting from Teams join URL (${attempt.label})`, () =>
          this.graphClient
            .api(endpoint)
            .filter(`JoinWebUrl eq '${attempt.value.replace(/'/g, "''")}'`)
            .get()
        )) as OnlineMeetingCollectionResponse;

        if (response.value?.length) {
          this.logger.info({ joinUrlVariant: attempt.label, meetingCount: response.value.length }, "teams sdk online meeting lookup succeeded");
          return response;
        }
      } catch (error) {
        lastError = error;
        this.logger.warn({ joinUrlVariant: attempt.label, err: error }, "teams sdk online meeting lookup variant failed");
      }
    }

    if (lastError instanceof Error) throw lastError;
    throw new Error("Microsoft Teams SDK flow could not resolve onlineMeeting from join URL");
  }

  private async waitForTranscript(onlineMeetingId: string): Promise<{
    transcript?: GraphCallTranscript;
    attempts: number;
    firstPollAt: Date;
    lastPollAt: Date;
    pendingDurationMs: number;
  }> {
    const deadline = Date.now() + env.TEAMS_GRAPH_TRANSCRIPT_TIMEOUT_MS;
    const firstPollAt = new Date();
    let lastPollAt = firstPollAt;
    let attempt = 0;

    while (Date.now() < deadline) {
      attempt += 1;
      lastPollAt = new Date();
      const endpoint = `/users/${encodeURIComponent(env.TEAMS_GRAPH_USER_ID!)}/onlineMeetings/${encodeURIComponent(onlineMeetingId)}/transcripts`;
      let response: CallTranscriptCollectionResponse;
      try {
        response = (await this.graphCall("list Teams meeting transcripts", () =>
          this.graphClient.api(endpoint).get()
        )) as CallTranscriptCollectionResponse;
      } catch (error) {
        if (!isRetryableGraphError(error)) throw error;
        this.logger.warn(
          { onlineMeetingId, attempt, retryInMs: env.TEAMS_GRAPH_TRANSCRIPT_POLL_INTERVAL_MS, err: error },
          "teams sdk transcript poll failed transiently; retrying"
        );
        await delay(env.TEAMS_GRAPH_TRANSCRIPT_POLL_INTERVAL_MS);
        continue;
      }

      const transcripts = (response.value ?? []).filter((transcript) => transcript.id);
      const selected = transcripts.sort((a, b) => Date.parse(b.endDateTime ?? b.createdDateTime ?? "") - Date.parse(a.endDateTime ?? a.createdDateTime ?? ""))[0];
      if (selected) {
        this.logger.info({ onlineMeetingId, transcriptId: selected.id, attempt }, "teams sdk transcript found");
        return { transcript: selected, attempts: attempt, firstPollAt, lastPollAt, pendingDurationMs: lastPollAt.getTime() - firstPollAt.getTime() };
      }

      this.logger.info(
        {
          onlineMeetingId,
          attempt,
          graph_response_status: 200,
          transcript_found: false,
          transcript_pending_duration: Date.now() - firstPollAt.getTime()
        },
        "teams sdk transcript not available yet"
      );
      await delay(env.TEAMS_GRAPH_TRANSCRIPT_POLL_INTERVAL_MS);
    }

    return { attempts: attempt, firstPollAt, lastPollAt, pendingDurationMs: lastPollAt.getTime() - firstPollAt.getTime() };
  }

  private async downloadTranscriptVtt(onlineMeetingId: string, transcriptId: string): Promise<string> {
    const endpoint = `/users/${encodeURIComponent(env.TEAMS_GRAPH_USER_ID!)}/onlineMeetings/${encodeURIComponent(onlineMeetingId)}/transcripts/${encodeURIComponent(transcriptId)}/content`;
    const content = (await this.graphCall("download Teams meeting transcript content", () =>
      this.graphClient
        .api(endpoint)
        .query({ $format: "text/vtt" })
        .header("accept", "text/vtt")
        .responseType(ResponseType.TEXT)
        .get()
    )) as string;

    this.logger.info({ onlineMeetingId, transcriptId, bytes: Buffer.byteLength(content, "utf8") }, "teams sdk transcript content downloaded");
    return content;
  }

  private async graphCall<T>(operation: string, request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      const details = graphErrorDetails(error);
      this.logger.error({ operation, graphError: details }, "teams sdk graph request failed");
      throw new Error(`Microsoft Teams Graph SDK failed to ${operation}: ${details.message}`);
    }
  }
}

function graphErrorDetails(error: unknown): Record<string, unknown> & { message: string } {
  if (!(error instanceof Error)) return { message: String(error) };
  const graphError = error as Error & {
    code?: string;
    statusCode?: number;
    requestId?: string;
    date?: string;
    body?: unknown;
  };

  return {
    message: graphError.message,
    code: graphError.code,
    statusCode: graphError.statusCode,
    requestId: graphError.requestId,
    date: graphError.date,
    body: graphError.body
  };
}

function isRetryableGraphError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch failed|network|socket|timeout|econnreset|etimedout|enotfound|eai_again/i.test(message)) return true;

  const statusCode = (error as { statusCode?: number } | undefined)?.statusCode;
  return Boolean(statusCode && [429, 500, 502, 503, 504].includes(statusCode));
}

function parseTeamsJoinContext(meetingUrl: string): TeamsJoinContext | undefined {
  try {
    const url = new URL(meetingUrl);
    const rawContext = url.searchParams.get("context");
    if (!rawContext) return undefined;
    const context = JSON.parse(rawContext) as TeamsJoinContext;
    if (!context.Tid && !context.Oid) return undefined;
    return context;
  } catch {
    return undefined;
  }
}

function joinWebUrlFilterCandidates(meetingUrl: string): Array<{ label: string; value: string }> {
  const candidates: Array<{ label: string; value: string }> = [{ label: "original", value: meetingUrl }];

  try {
    const decoded = decodeURI(meetingUrl);
    if (!candidates.some((candidate) => candidate.value === decoded)) candidates.push({ label: "decoded", value: decoded });
  } catch {
    // Keep original only when decoding fails.
  }

  const encoded = encodeURI(meetingUrl);
  if (!candidates.some((candidate) => candidate.value === encoded)) candidates.push({ label: "encoded-uri", value: encoded });

  const fullyEncoded = encodeURIComponent(meetingUrl);
  if (!candidates.some((candidate) => candidate.value === fullyEncoded)) candidates.push({ label: "encoded-component", value: fullyEncoded });

  return candidates;
}

function parseTeamsVtt(vtt: string): ParsedVttSegment[] {
  const blocks = vtt
    .replace(/^\uFEFF/, "")
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

    const speakerMatch = payload.match(/<v(?:\s+([^>]+))?>([\s\S]*?)<\/v>/i);
    const speaker = cleanVttText(speakerMatch?.[1] ?? "Speaker");
    const text = cleanVttText(speakerMatch?.[2] ?? payload);
    if (!text) continue;

    segments.push({ speaker: speaker || "Speaker", text, startSeconds, endSeconds });
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
