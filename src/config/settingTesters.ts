import { SarvamAIClient } from "sarvamai";
import { env } from "./env";
import { cfgString } from "./runtimeConfig";

// Live "Test connection" checks for managed settings. A tester takes the value
// to test (a candidate the admin typed, or the currently-resolved value) and
// reports whether the provider accepts it — WITHOUT persisting anything.

export type TestStatus = "ok" | "no_credits" | "unauthorized" | "error";

export interface TestResult {
  ok: boolean;
  status: TestStatus;
  detail: string;
}

type Tester = (value: string, key: string) => Promise<TestResult>;

const TEST_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms))
  ]);
}

// Cheap, no-audio auth probe: language identification on a tiny string. A valid
// key returns a result; an invalid key makes the SDK throw an auth error.
async function testSarvam(value: string): Promise<TestResult> {
  if (!value) return { ok: false, status: "error", detail: "No key to test" };
  try {
    const client = new SarvamAIClient({ apiSubscriptionKey: value });
    await withTimeout(client.text.identifyLanguage({ input: "hello" }), TEST_TIMEOUT_MS);
    return { ok: true, status: "ok", detail: "Sarvam accepted the key" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // 402 / quota: the key authenticated fine, the account just has no credits —
    // a distinct, important state vs an invalid key.
    if (/insufficient_quota|no credits|\b402\b/i.test(msg)) {
      return { ok: false, status: "no_credits", detail: "Key is valid, but the Sarvam account has no credits left" };
    }
    if (/\b401\b|\b403\b|unauthor|forbidden|invalid.*key|api.?key/i.test(msg)) {
      return { ok: false, status: "unauthorized", detail: "Sarvam rejected the key (unauthorized)" };
    }
    if (/timed out/i.test(msg)) return { ok: false, status: "error", detail: "Sarvam did not respond (timed out)" };
    return { ok: false, status: "error", detail: msg.replace(/\s+/g, " ").slice(0, 160) };
  }
}

// Zoom server-to-server OAuth: validity depends on account ID + client ID +
// secret together, so test the whole set — substituting the candidate value for
// whichever key is being tested, and the saved values for the rest.
async function testZoom(value: string, key: string): Promise<TestResult> {
  const accountId = key === "ZOOM_ACCOUNT_ID" ? value : cfgString("ZOOM_ACCOUNT_ID");
  const clientId = key === "ZOOM_CLIENT_ID" ? value : cfgString("ZOOM_CLIENT_ID");
  const clientSecret = key === "ZOOM_CLIENT_SECRET" ? value : cfgString("ZOOM_CLIENT_SECRET");
  if (!accountId || !clientId || !clientSecret) {
    return { ok: false, status: "error", detail: "Set Zoom account ID, client ID and secret first" };
  }
  try {
    const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const url = `${env.ZOOM_OAUTH_BASE_URL}/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`;
    const res = await withTimeout(
      fetch(url, { method: "POST", headers: { Authorization: `Basic ${creds}` } }),
      TEST_TIMEOUT_MS
    );
    if (res.ok) return { ok: true, status: "ok", detail: "Zoom accepted the credentials" };
    if (res.status === 401 || res.status === 400) {
      return { ok: false, status: "unauthorized", detail: "Zoom rejected the credentials" };
    }
    const body = await res.text().catch(() => "");
    return { ok: false, status: "error", detail: `Zoom returned ${res.status} ${body.replace(/\s+/g, " ").slice(0, 100)}`.trim() };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/timed out/i.test(msg)) return { ok: false, status: "error", detail: "Zoom did not respond (timed out)" };
    return { ok: false, status: "error", detail: msg.replace(/\s+/g, " ").slice(0, 160) };
  }
}

const TESTERS: Record<string, Tester> = {
  SARVAM_API_KEY: testSarvam,
  // Only the secret is "testable" in the UI; the test validates the whole Zoom
  // credential set (account ID + client ID + secret) via a token fetch.
  ZOOM_CLIENT_SECRET: testZoom
};

export function isSettingTestable(key: string): boolean {
  return key in TESTERS;
}

// Test `value` if provided, otherwise the currently-resolved value for the key.
export async function runSettingTest(key: string, value?: string): Promise<TestResult> {
  const tester = TESTERS[key];
  if (!tester) return { ok: false, status: "error", detail: "No connection test for this setting" };
  return tester(value ?? cfgString(key) ?? "", key);
}
