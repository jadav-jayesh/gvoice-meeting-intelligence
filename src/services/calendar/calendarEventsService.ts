import { env } from "../../config/env";
import {
  CalendarConnectionModel,
  type CalendarConnectionDocument,
  type CalendarProvider
} from "../../models/CalendarConnection";
import type { BotPlatform } from "../../types/meeting";
import { decryptSecret, encryptSecret } from "../../utils/tokenCrypto";
import { detectPlatformFromUrl, extractMeetingUrl, meetingDedupeKey } from "../../utils/meetingUrl";
import { refreshAccessToken } from "./calendarOAuthService";
import { logger as rootLogger } from "../../utils/logger";

// On-demand read of a user's upcoming calendar meetings, normalized across
// providers. Used by the Calendar tab to show what the bot will auto-join, and
// reused later by the sync poller/scheduler. Each provider's access token is
// refreshed and persisted as needed; a connection whose refresh fails is marked
// so the UI can prompt a reconnect instead of silently showing nothing.

export interface UpcomingMeeting {
  id: string;
  source: CalendarProvider;
  title: string;
  startTime: string; // ISO
  endTime: string; // ISO
  joinUrl?: string;
  platform?: BotPlatform;
  organizer?: string;
  isAllDay: boolean;
  // True when there's a recognized meeting link — i.e. the bot will auto-join.
  autoJoin: boolean;
}

const ACCESS_TOKEN_SKEW_MS = 60_000; // refresh a minute before actual expiry

export interface MeetingWindow {
  from?: Date;
  to?: Date;
}

/** Meetings across all of a user's connected calendars (deduped, sorted). */
export async function getUpcomingMeetings(
  userId: string,
  window: MeetingWindow = {}
): Promise<{
  meetings: UpcomingMeeting[];
  connectionErrors: Array<{ provider: CalendarProvider; error: string }>;
}> {
  const connections = await CalendarConnectionModel.find({ userId, status: { $ne: "revoked" } });
  const windowStart = window.from ?? new Date();
  const windowEnd = window.to ?? new Date(windowStart.getTime() + env.CALENDAR_LOOKAHEAD_HOURS * 3600 * 1000);

  const all: UpcomingMeeting[] = [];
  const connectionErrors: Array<{ provider: CalendarProvider; error: string }> = [];

  for (const connection of connections) {
    try {
      const accessToken = await ensureAccessToken(connection);
      const events =
        connection.provider === "google"
          ? await fetchGoogleEvents(accessToken, windowStart, windowEnd)
          : await fetchMicrosoftEvents(accessToken, windowStart, windowEnd);
      all.push(...events);
      // A good fetch clears any stale error from a previous transient failure
      // (e.g. a token refresh that raced a restart) — otherwise the badge would
      // stay "error" forever despite the calendar working.
      if (connection.status !== "connected" || connection.lastError) {
        await CalendarConnectionModel.updateOne(
          { _id: connection._id },
          { $set: { status: "connected", lastSyncedAt: new Date() }, $unset: { lastError: "" } }
        ).catch(() => undefined);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rootLogger.warn({ err: error, provider: connection.provider, userId }, "calendar events fetch failed");
      await CalendarConnectionModel.updateOne(
        { _id: connection._id },
        { $set: { status: "error", lastError: message.slice(0, 500) } }
      ).catch(() => undefined);
      connectionErrors.push({ provider: connection.provider, error: message });
    }
  }

  return { meetings: dedupeAndSort(all), connectionErrors };
}

// Same meeting can appear on several connected calendars — collapse so one bot
// joins, then sort chronologically. The key includes the start time because a
// recurring meeting reuses ONE join URL across every occurrence; keying on the
// URL alone would collapse the whole series into a single event. Pairing the
// URL with the occurrence start still merges the same meeting seen on two
// calendars (identical URL + identical UTC start) while keeping distinct
// occurrences apart.
function dedupeAndSort(meetings: UpcomingMeeting[]): UpcomingMeeting[] {
  const byKey = new Map<string, UpcomingMeeting>();
  for (const meeting of meetings) {
    const key = meeting.joinUrl
      ? `${meetingDedupeKey(meeting.joinUrl)}@${meeting.startTime}`
      : `${meeting.source}:${meeting.id}`;
    const existing = byKey.get(key);
    if (!existing || meeting.startTime < existing.startTime) byKey.set(key, meeting);
  }
  return [...byKey.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
}

// ── Token management ────────────────────────────────────────────────────────

async function ensureAccessToken(connection: CalendarConnectionDocument): Promise<string> {
  const stillValid =
    connection.accessToken &&
    connection.accessTokenExpiresAt &&
    connection.accessTokenExpiresAt.getTime() - ACCESS_TOKEN_SKEW_MS > Date.now();
  if (stillValid) return connection.accessToken as string;

  const refreshToken = decryptSecret(connection.refreshTokenEncrypted);
  const tokens = await refreshAccessToken(connection.provider, refreshToken, connection.oauthClientId);

  connection.accessToken = tokens.accessToken;
  connection.accessTokenExpiresAt = tokens.expiresAt;
  if (tokens.refreshToken && tokens.refreshToken !== refreshToken) {
    connection.refreshTokenEncrypted = encryptSecret(tokens.refreshToken);
  }
  connection.status = "connected";
  connection.lastError = undefined;
  await connection.save();
  return tokens.accessToken;
}

// ── Google Calendar ─────────────────────────────────────────────────────────

interface GoogleEvent {
  id?: string;
  summary?: string;
  status?: string;
  hangoutLink?: string;
  location?: string;
  description?: string;
  organizer?: { displayName?: string; email?: string };
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
}

async function fetchGoogleEvents(accessToken: string, start: Date, end: Date): Promise<UpcomingMeeting[]> {
  // singleEvents expands recurring series into individual occurrences, so a busy
  // window can span multiple pages — follow nextPageToken (capped).
  const items: GoogleEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250"
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      throw new Error(`Google Calendar API ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const body = (await response.json()) as { items?: GoogleEvent[]; nextPageToken?: string };
    items.push(...(body.items ?? []));
    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  const out: UpcomingMeeting[] = [];
  for (const event of items) {
    if (event.status === "cancelled") continue;
    const isAllDay = Boolean(event.start?.date && !event.start?.dateTime);
    const startTime = event.start?.dateTime ?? toAllDayIso(event.start?.date);
    const endTime = event.end?.dateTime ?? toAllDayIso(event.end?.date);
    if (!startTime) continue;

    const conferenceUri = event.conferenceData?.entryPoints?.find(
      (entry) => entry.entryPointType === "video" && entry.uri
    )?.uri;
    const joinUrl =
      event.hangoutLink ?? conferenceUri ?? extractMeetingUrl(event.location) ?? extractMeetingUrl(event.description);
    out.push(
      normalize("google", event.id ?? startTime, event.summary, startTime, endTime, joinUrl, event.organizer?.displayName ?? event.organizer?.email, isAllDay)
    );
  }
  return out;
}

// ── Microsoft Graph ─────────────────────────────────────────────────────────

interface GraphEvent {
  id?: string;
  subject?: string;
  isCancelled?: boolean;
  isAllDay?: boolean;
  onlineMeeting?: { joinUrl?: string };
  onlineMeetingUrl?: string;
  location?: { displayName?: string };
  bodyPreview?: string;
  body?: { content?: string };
  organizer?: { emailAddress?: { name?: string; address?: string } };
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
}

async function fetchMicrosoftEvents(accessToken: string, start: Date, end: Date): Promise<UpcomingMeeting[]> {
  const params = new URLSearchParams({
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    $orderby: "start/dateTime",
    $top: "100"
  });
  // calendarView expands recurring series into one event per occurrence, so a
  // busy month easily exceeds one page. Follow @odata.nextLink (cap the page
  // count so a runaway link can't loop forever).
  let url: string | undefined = `https://graph.microsoft.com/v1.0/me/calendarView?${params}`;
  const events: GraphEvent[] = [];
  for (let page = 0; url && page < 10; page++) {
    const response: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"' }
    });
    if (!response.ok) {
      throw new Error(`Microsoft Graph ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const body = (await response.json()) as { value?: GraphEvent[]; "@odata.nextLink"?: string };
    events.push(...(body.value ?? []));
    url = body["@odata.nextLink"];
  }
  const out: UpcomingMeeting[] = [];
  for (const event of events) {
    if (event.isCancelled) continue;
    // Graph returns naive UTC strings (no 'Z') when we Prefer UTC — append it.
    const startTime = toUtcIso(event.start?.dateTime);
    const endTime = toUtcIso(event.end?.dateTime);
    if (!startTime) continue;

    const joinUrl =
      event.onlineMeeting?.joinUrl ??
      event.onlineMeetingUrl ??
      extractMeetingUrl(event.location?.displayName) ??
      extractMeetingUrl(event.body?.content) ??
      extractMeetingUrl(event.bodyPreview);
    out.push(
      normalize("microsoft", event.id ?? startTime, event.subject, startTime, endTime, joinUrl, event.organizer?.emailAddress?.name ?? event.organizer?.emailAddress?.address, Boolean(event.isAllDay))
    );
  }
  return out;
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function normalize(
  source: CalendarProvider,
  id: string,
  title: string | undefined,
  startTime: string,
  endTime: string | undefined,
  joinUrl: string | undefined,
  organizer: string | undefined,
  isAllDay: boolean
): UpcomingMeeting {
  const platform = joinUrl ? detectPlatformFromUrl(joinUrl) : undefined;
  return {
    id,
    source,
    title: title?.trim() || "(no title)",
    startTime,
    endTime: endTime ?? startTime,
    joinUrl: platform ? joinUrl : undefined,
    platform,
    organizer,
    isAllDay,
    autoJoin: Boolean(platform)
  };
}

function toAllDayIso(date: string | undefined): string | undefined {
  return date ? new Date(`${date}T00:00:00`).toISOString() : undefined;
}

function toUtcIso(dateTime: string | undefined): string | undefined {
  if (!dateTime) return undefined;
  const withZone = /[zZ]|[+-]\d{2}:\d{2}$/.test(dateTime) ? dateTime : `${dateTime}Z`;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
