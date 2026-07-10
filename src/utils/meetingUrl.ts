import type { BotPlatform } from "../types/meeting";

// Maps a raw meeting/join URL to the bot platform that can join it. Calendar
// events carry links from any provider regardless of which calendar they live
// on (a Zoom link can sit in an Outlook event), so platform is decided by the
// URL host, not the calendar source.
//
// Returns undefined when the URL is not a recognized meeting link — the caller
// skips those events (no auto-join target).

const HOST_PATTERNS: Array<{ platform: BotPlatform; test: (host: string, url: string) => boolean }> = [
  { platform: "google_meet", test: (host) => host === "meet.google.com" },
  {
    platform: "microsoft_teams",
    test: (host) => host === "teams.microsoft.com" || host === "teams.live.com" || host.endsWith(".teams.microsoft.com")
  },
  { platform: "zoom", test: (host) => host === "zoom.us" || host.endsWith(".zoom.us") }
];

/** Recognized meeting platform for a URL, or undefined if it isn't one. */
export function detectPlatformFromUrl(rawUrl: string): BotPlatform | undefined {
  const url = tryParseUrl(rawUrl);
  if (!url) return undefined;
  const host = url.hostname.toLocaleLowerCase("en-US");
  return HOST_PATTERNS.find((entry) => entry.test(host, rawUrl))?.platform;
}

/**
 * Find the first meeting link inside a blob of text (event location, body, or
 * description). Calendar providers don't always put the join URL in a
 * structured field, so we scan free text as a fallback.
 */
export function extractMeetingUrl(text: string | undefined | null): string | undefined {
  if (!text) return undefined;
  const matches = text.match(/https?:\/\/[^\s"'<>)\]]+/gi);
  if (!matches) return undefined;
  for (const candidate of matches) {
    // Trim trailing punctuation that commonly clings to URLs in prose.
    const cleaned = candidate.replace(/[.,;>)\]]+$/g, "");
    if (detectPlatformFromUrl(cleaned)) return cleaned;
  }
  return undefined;
}

/**
 * Stable key for de-duplicating the SAME meeting discovered on several
 * connected calendars (e.g. 5 colleagues invited to one call). Strips query/
 * fragment noise and lowercases the host so trivially-different URLs collapse
 * to one bot. Falls back to the raw string when unparseable.
 */
export function meetingDedupeKey(rawUrl: string): string {
  const url = tryParseUrl(rawUrl);
  if (!url) return rawUrl.trim().toLocaleLowerCase("en-US");
  const host = url.hostname.toLocaleLowerCase("en-US");
  const path = url.pathname.replace(/\/+$/g, "");
  const platform = detectPlatformFromUrl(rawUrl);

  // Zoom encodes the passcode in `?pwd=`; keep it so the dedupe key still maps
  // to a joinable URL, but drop everything else.
  if (platform === "zoom") {
    const pwd = url.searchParams.get("pwd");
    return `${host}${path}${pwd ? `?pwd=${pwd}` : ""}`;
  }
  return `${host}${path}`;
}

function tryParseUrl(rawUrl: string): URL | undefined {
  try {
    return new URL(rawUrl.trim());
  } catch {
    return undefined;
  }
}
