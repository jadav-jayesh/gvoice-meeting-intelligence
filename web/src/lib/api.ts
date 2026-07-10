import type { Meeting, MeetingListResponse, BotPlatform, BotStatus, User, UserRole } from "./types";

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}

type OnUnauthorized = () => void;
let onUnauthorized: OnUnauthorized | null = null;

// AuthProvider registers a callback here so any 401 from any endpoint can
// clear the in-memory user state and bounce the user to /login without
// every caller having to handle it themselves.
export function setUnauthorizedHandler(handler: OnUnauthorized | null) {
  onUnauthorized = handler;
}

// Read a cookie value by name from document.cookie. Returns null if not set.
function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const target = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(target)) return decodeURIComponent(trimmed.slice(target.length));
  }
  return null;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const REFRESH_PATH = "/api/auth/refresh";

// Single-flight refresh. If multiple in-flight requests all get 401 around
// the same time (common after the access token expires), they all `await`
// the same refresh attempt instead of hammering the endpoint.
let refreshInFlight: Promise<boolean> | null = null;

async function performRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const csrf = readCookie("csrf");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (csrf) headers["X-CSRF-Token"] = csrf;
      const res = await fetch(REFRESH_PATH, {
        method: "POST",
        credentials: "include",
        headers
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      // Clear AFTER the request resolves so concurrent callers all see the
      // same outcome, then subsequent requests start fresh.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();
  return refreshInFlight;
}

async function rawFetch(path: string, init: RequestInit | undefined, method: string): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string>) ?? {})
  };
  // Double-submit CSRF: echo the csrf cookie back as a header on writes. If
  // the cookie isn't there yet (e.g. first request after a hard refresh), we
  // skip the header — the server will respond 403 and the caller can react.
  if (!SAFE_METHODS.has(method)) {
    const csrf = readCookie("csrf");
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  return fetch(path, {
    credentials: "include",
    ...init,
    headers
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();

  let response = await rawFetch(path, init, method);

  // Transparent re-auth: on 401, try to refresh the access token once and
  // retry the original request. Skip for the refresh endpoint itself
  // (infinite loop) and for login/signup (no session to refresh).
  if (
    response.status === 401 &&
    path !== REFRESH_PATH &&
    !path.endsWith("/api/auth/login") &&
    !path.endsWith("/api/auth/signup")
  ) {
    const refreshed = await performRefresh();
    if (refreshed) {
      response = await rawFetch(path, init, method);
    }
  }

  if (response.status === 401) {
    if (onUnauthorized) onUnauthorized();
    throw new UnauthorizedError();
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

// ── Calendar auto-join connections ──────────────────────────────────────────

export type CalendarProvider = "google" | "microsoft";

export interface CalendarConnection {
  provider: CalendarProvider;
  accountEmail?: string;
  accountName?: string;
  status: "connected" | "revoked" | "error";
  lastSyncedAt?: string;
  lastError?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CalendarConnectionsResponse {
  connections: CalendarConnection[];
  available: Record<CalendarProvider, boolean>;
}

export function getCalendarConnections(): Promise<CalendarConnectionsResponse> {
  return request<CalendarConnectionsResponse>("/api/calendar/connections");
}

// Returns the provider authorize URL; the caller navigates the browser to it.
export function startCalendarConnect(provider: CalendarProvider): Promise<{ url: string }> {
  return request<{ url: string }>(`/api/calendar/${provider}/start`);
}

export function disconnectCalendar(provider: CalendarProvider): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/calendar/connections/${provider}`, { method: "DELETE" });
}

export interface UpcomingMeeting {
  id: string;
  source: CalendarProvider;
  title: string;
  startTime: string;
  endTime: string;
  joinUrl?: string;
  platform?: BotPlatform;
  organizer?: string;
  isAllDay: boolean;
  autoJoin: boolean;
}

export interface UpcomingMeetingsResponse {
  meetings: UpcomingMeeting[];
  connectionErrors: Array<{ provider: CalendarProvider; error: string }>;
}

export function getUpcomingMeetings(range?: { from: string; to: string }): Promise<UpcomingMeetingsResponse> {
  const suffix = range ? `?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : "";
  return request<UpcomingMeetingsResponse>(`/api/calendar/events${suffix}`);
}

export interface ListMeetingsParams {
  page?: number;
  pageSize?: number;
  platform?: BotPlatform;
  status?: BotStatus;
  search?: string;
}

export function listMeetings(params: ListMeetingsParams = {}): Promise<MeetingListResponse> {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.platform) query.set("platform", params.platform);
  if (params.status) query.set("status", params.status);
  if (params.search) query.set("search", params.search);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<MeetingListResponse>(`/api/meetings${suffix}`);
}

export function getMeeting(sessionId: string): Promise<Meeting> {
  return request<Meeting>(`/api/meetings/${encodeURIComponent(sessionId)}`);
}

// Deletes the meeting for the current user. `purged` is true when this was the
// last viewer and the recording + data were permanently removed.
export function deleteMeeting(sessionId: string): Promise<{ ok: boolean; purged: boolean }> {
  return request<{ ok: boolean; purged: boolean }>(`/api/meetings/${encodeURIComponent(sessionId)}`, {
    method: "DELETE"
  });
}

export interface MeetingStats {
  total: number;
  recorded: number;
  positive: number;
  positiveShare: number | null;
  actionItems: number;
  avgActions: number | null;
}

export function getMeetingStats(): Promise<MeetingStats> {
  return request<MeetingStats>("/api/meetings/stats");
}

// ===== Insights (Dashboard action items, Insights participation/topics) =====

export type InsightRange = "7d" | "30d" | "90d" | "all";

export interface ActionItemInsights {
  total: number;
  done: number;
  open: number;
  completionRate: number;
  byPriority: { high: number; medium: number; low: number };
  byOwner: Array<{ owner: string; open: number; total: number }>;
  overdue: Array<{ task: string; owner: string; due: string; sessionId: string }>;
  overdueCount: number;
}

export interface ParticipationInsights {
  speakers: Array<{ name: string; talkSeconds: number; meetings: number; share: number }>;
  totalTalkSeconds: number;
}

export interface TopicsInsights {
  topics: Array<{ label: string; count: number; sessions: string[] }>;
}

export function getActionItemInsights(range: InsightRange = "30d"): Promise<ActionItemInsights> {
  return request<ActionItemInsights>(`/api/insights/action-items?range=${range}`);
}

export function getParticipation(range: InsightRange = "30d"): Promise<ParticipationInsights> {
  return request<ParticipationInsights>(`/api/insights/participation?range=${range}`);
}

export function getTopics(range: InsightRange = "30d"): Promise<TopicsInsights> {
  return request<TopicsInsights>(`/api/insights/topics?range=${range}`);
}

export interface CreateBotSessionPayload {
  platform: BotPlatform;
  meetingUrl: string;
  meetingPasscode?: string;
  webhookUrl?: string;
}

export interface CreateBotSessionResponse {
  sessionId: string;
  status: BotStatus;
  // True when the server attached to a bot already live in this meeting instead
  // of launching a second one (one bot per live meeting). The returned session
  // belongs to whoever started it first, so the caller should NOT navigate to it.
  attached?: boolean;
}

export function createBotSession(payload: CreateBotSessionPayload): Promise<CreateBotSessionResponse> {
  return request<CreateBotSessionResponse>("/bots", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

// ===== Auth =====

export interface SignupPayload {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface UpdateProfilePayload {
  firstName?: string;
  lastName?: string;
}

interface UserResponse {
  user: User;
}

export function signup(payload: SignupPayload): Promise<UserResponse> {
  return request<UserResponse>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function login(payload: LoginPayload): Promise<UserResponse> {
  return request<UserResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function logout(): Promise<{ ok: true }> {
  return request<{ ok: true }>("/api/auth/logout", { method: "POST" });
}

export function getMe(): Promise<UserResponse> {
  return request<UserResponse>("/api/auth/me");
}

export function updateMe(payload: UpdateProfilePayload): Promise<UserResponse> {
  return request<UserResponse>("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export function changePassword(payload: ChangePasswordPayload): Promise<{ ok: true }> {
  return request<{ ok: true }>("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteAccount(password: string): Promise<{ ok: true }> {
  return request<{ ok: true }>("/api/auth/me", {
    method: "DELETE",
    body: JSON.stringify({ password })
  });
}

// ── Admin (Super Admin dashboard) ───────────────────────────────────────────

export interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  createdAt?: string;
  meetingCount: number;
  minutes: number;
}

export interface AdminUsersResponse {
  items: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface AdminUsersParams {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: UserRole;
  sort?: "createdAt" | "email" | "name";
  order?: "asc" | "desc";
}

export function adminListUsers(params: AdminUsersParams = {}): Promise<AdminUsersResponse> {
  const q = new URLSearchParams();
  if (params.page) q.set("page", String(params.page));
  if (params.pageSize) q.set("pageSize", String(params.pageSize));
  if (params.search) q.set("search", params.search);
  if (params.role) q.set("role", params.role);
  if (params.sort) q.set("sort", params.sort);
  if (params.order) q.set("order", params.order);
  const suffix = q.toString() ? `?${q.toString()}` : "";
  return request<AdminUsersResponse>(`/api/admin/users${suffix}`);
}

export function adminSetUserRole(id: string, role: UserRole): Promise<{ user: { id: string; email: string; role: UserRole } }> {
  return request<{ user: { id: string; email: string; role: UserRole } }>(
    `/api/admin/users/${encodeURIComponent(id)}/role`,
    { method: "PATCH", body: JSON.stringify({ role }) }
  );
}

export interface AdminAnalyticsSummary {
  userCount: number;
  meetingCount: number;
  totalMinutes: number;
  activeWindowDays: number;
  activeUsers: number;
  activeByLogin: number;
}

export function adminGetAnalyticsSummary(): Promise<AdminAnalyticsSummary> {
  return request<AdminAnalyticsSummary>("/api/admin/analytics/summary");
}

export interface AdminTrendPoint {
  date: string;
  signups: number;
  meetings: number;
}

export interface AdminTrendsResponse {
  days: number;
  series: AdminTrendPoint[];
}

export function adminGetAnalyticsTrends(days = 30): Promise<AdminTrendsResponse> {
  return request<AdminTrendsResponse>(`/api/admin/analytics/trends?days=${days}`);
}

// ── Admin settings (runtime config) ─────────────────────────────────────────

export interface AdminSetting {
  key: string;
  group: string;
  label: string;
  isSecret: boolean;
  type: "string" | "number" | "enum";
  options?: string[];
  help?: string;
  testable: boolean;
  isSet: boolean;
  source: "db" | "env";
  last4?: string;
  value?: string;
}

export type AdminSettingTestStatus = "ok" | "no_credits" | "unauthorized" | "error";

export interface AdminSettingTestResult {
  ok: boolean;
  status: AdminSettingTestStatus;
  detail: string;
}

export function adminTestSetting(key: string, value?: string): Promise<AdminSettingTestResult> {
  return request<AdminSettingTestResult>(`/api/admin/settings/${encodeURIComponent(key)}/test`, {
    method: "POST",
    body: JSON.stringify(value !== undefined ? { value } : {})
  });
}

export function adminGetSettings(): Promise<{ settings: AdminSetting[] }> {
  return request<{ settings: AdminSetting[] }>("/api/admin/settings");
}

export function adminUpdateSetting(key: string, value: string, password?: string): Promise<{ settings: AdminSetting[] }> {
  return request<{ settings: AdminSetting[] }>(`/api/admin/settings/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify({ value, password })
  });
}

export function adminRevertSetting(key: string): Promise<{ settings: AdminSetting[] }> {
  return request<{ settings: AdminSetting[] }>(`/api/admin/settings/${encodeURIComponent(key)}`, {
    method: "DELETE"
  });
}
