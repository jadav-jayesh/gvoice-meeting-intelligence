import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { cfgString } from "../../config/runtimeConfig";
import type { CalendarProvider } from "../../models/CalendarConnection";

// OAuth 2.0 authorization-code flow for the "Connect calendar" buttons,
// implemented with fetch (no SDK) so it matches the codebase's existing
// fetch-based provider clients (Zoom/Sarvam/Whisper). Two providers behind one
// interface:
//   - google    → its OWN OAuth web client (GOOGLE_OAUTH_*)
//   - microsoft → REUSES the existing Graph app (TEAMS_GRAPH_CLIENT_ID/SECRET),
//                 adding only the delegated redirect URI + tenant.
//
// We never store the authorization code; we immediately exchange it for an
// access token (cached) + a refresh token (encrypted by the caller).

export interface OAuthTokens {
  accessToken: string;
  // Absent on Google refreshes and some Microsoft refreshes — caller keeps the
  // previously stored refresh token in that case.
  refreshToken?: string;
  expiresAt: Date;
  scopes: string[];
}

export interface AccountIdentity {
  email?: string;
  name?: string;
}

interface ProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
  clientId: () => string | undefined;
  clientSecret: () => string | undefined;
  redirectUri: string;
  // Extra params appended to the authorize URL (e.g. Google's offline access).
  extraAuthParams: Record<string, string>;
}

const PROVIDERS: Record<CalendarProvider, ProviderConfig> = {
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scopes: ["openid", "email", "profile", "https://www.googleapis.com/auth/calendar.events.readonly"],
    clientId: () => env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: () => cfgString("GOOGLE_OAUTH_CLIENT_SECRET"),
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
    // access_type=offline + prompt=consent guarantees a refresh_token even on
    // re-consent (Google omits it otherwise).
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" }
  },
  microsoft: {
    authorizeUrl: `https://login.microsoftonline.com/${env.MS_OAUTH_TENANT}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${env.MS_OAUTH_TENANT}/oauth2/v2.0/token`,
    userInfoUrl: "https://graph.microsoft.com/v1.0/me",
    scopes: ["openid", "email", "profile", "offline_access", "User.Read", "Calendars.Read"],
    // Prefer the dedicated calendar app (registered to also accept personal
    // Microsoft accounts); fall back to the Teams Graph app (work/school only).
    clientId: () => env.MS_CALENDAR_CLIENT_ID || env.TEAMS_GRAPH_CLIENT_ID,
    clientSecret: () => cfgString("MS_CALENDAR_CLIENT_SECRET") || cfgString("TEAMS_GRAPH_CLIENT_SECRET"),
    redirectUri: env.MS_OAUTH_REDIRECT_URI,
    extraAuthParams: { prompt: "select_account" }
  }
};

const STATE_PURPOSE = "cal_oauth";

export function isProviderConfigured(provider: CalendarProvider): boolean {
  const config = PROVIDERS[provider];
  return Boolean(config.clientId() && config.clientSecret());
}

/** The client_id used for NEW authorize/exchange — persisted on the connection
 *  so later refreshes can use the same app that issued the tokens. */
export function getProviderClientId(provider: CalendarProvider): string | undefined {
  return PROVIDERS[provider].clientId();
}

// Refresh tokens are bound to the app that issued them, so a refresh must use
// the same client_id/secret. Resolve them from the client_id stored on the
// connection, letting the dedicated calendar app (personal-account capable) and
// the legacy Teams Graph app coexist without breaking existing connections.
function refreshClientCreds(
  provider: CalendarProvider,
  storedClientId?: string
): { clientId?: string; clientSecret?: string } {
  const config = PROVIDERS[provider];
  if (provider === "microsoft") {
    if (storedClientId && env.MS_CALENDAR_CLIENT_ID && storedClientId === env.MS_CALENDAR_CLIENT_ID) {
      return { clientId: env.MS_CALENDAR_CLIENT_ID, clientSecret: cfgString("MS_CALENDAR_CLIENT_SECRET") };
    }
    // Tokens issued by the Teams Graph app — including legacy rows with no
    // stored client_id (they predate the dedicated calendar app) — refresh with
    // the Teams Graph app so existing connections keep working.
    if ((!storedClientId || storedClientId === env.TEAMS_GRAPH_CLIENT_ID) && env.TEAMS_GRAPH_CLIENT_ID) {
      return { clientId: env.TEAMS_GRAPH_CLIENT_ID, clientSecret: cfgString("TEAMS_GRAPH_CLIENT_SECRET") };
    }
  }
  return { clientId: config.clientId(), clientSecret: config.clientSecret() };
}

/** Sign a short-lived, tamper-proof state that ties the callback to a user. */
export function signOAuthState(userId: string, provider: CalendarProvider): string {
  return jwt.sign({ uid: userId, provider, purpose: STATE_PURPOSE }, env.JWT_SECRET, { expiresIn: "10m" });
}

export function verifyOAuthState(state: string, provider: CalendarProvider): { userId: string } {
  const decoded = jwt.verify(state, env.JWT_SECRET) as { uid?: string; provider?: string; purpose?: string };
  if (decoded.purpose !== STATE_PURPOSE || decoded.provider !== provider || !decoded.uid) {
    throw new Error("invalid oauth state");
  }
  return { userId: decoded.uid };
}

/** Build the provider authorize URL the browser is redirected to. */
export function buildAuthorizeUrl(provider: CalendarProvider, state: string): string {
  const config = PROVIDERS[provider];
  assertConfigured(provider);
  const params = new URLSearchParams({
    client_id: config.clientId() as string,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scopes.join(" "),
    state,
    ...config.extraAuthParams
  });
  return `${config.authorizeUrl}?${params.toString()}`;
}

/** Exchange an authorization code for tokens. */
export async function exchangeCodeForTokens(provider: CalendarProvider, code: string): Promise<OAuthTokens> {
  const config = PROVIDERS[provider];
  assertConfigured(provider);
  return tokenRequest(config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri
  });
}

/** Trade a stored refresh token for a fresh access token. */
export async function refreshAccessToken(
  provider: CalendarProvider,
  refreshToken: string,
  storedClientId?: string
): Promise<OAuthTokens> {
  const config = PROVIDERS[provider];
  assertConfigured(provider);
  const tokens = await tokenRequest(
    config,
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      // Microsoft requires scope on refresh; Google ignores it.
      scope: config.scopes.join(" ")
    },
    refreshClientCreds(provider, storedClientId)
  );
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}

/** Read the authorized account's email/name for display. */
export async function fetchAccountIdentity(provider: CalendarProvider, accessToken: string): Promise<AccountIdentity> {
  const config = PROVIDERS[provider];
  const response = await fetch(config.userInfoUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return {};
  const body = (await response.json()) as Record<string, unknown>;
  if (provider === "google") {
    return { email: asString(body.email), name: asString(body.name) };
  }
  return {
    email: asString(body.mail) ?? asString(body.userPrincipalName),
    name: asString(body.displayName)
  };
}

async function tokenRequest(
  config: ProviderConfig,
  fields: Record<string, string>,
  creds?: { clientId?: string; clientSecret?: string }
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    client_id: (creds?.clientId ?? config.clientId()) as string,
    client_secret: (creds?.clientSecret ?? config.clientSecret()) as string,
    ...fields
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OAuth token request failed with ${response.status}: ${text.slice(0, 500)}`);
  }

  const json = JSON.parse(text) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!json.access_token) throw new Error("OAuth token response missing access_token");

  const expiresInSeconds = typeof json.expires_in === "number" ? json.expires_in : 3600;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    scopes: json.scope ? json.scope.split(/\s+/).filter(Boolean) : config.scopes
  };
}

function assertConfigured(provider: CalendarProvider): void {
  if (!isProviderConfigured(provider)) {
    throw new Error(
      provider === "google"
        ? "Google calendar OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET."
        : "Microsoft calendar OAuth is not configured. Set TEAMS_GRAPH_CLIENT_ID and TEAMS_GRAPH_CLIENT_SECRET."
    );
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
