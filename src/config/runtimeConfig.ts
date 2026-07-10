import { env } from "./env";
import { SettingModel } from "../models/Setting";
import { encryptSecret, decryptSecret } from "../utils/tokenCrypto";
import { logger } from "../utils/logger";

// ── Runtime configuration ────────────────────────────────────────────────────
//
// A small layer over `env` that lets a Super Admin override a curated set of
// keys from the database (Settings page) WITHOUT a service restart.
//
// Resolution order for a managed key: DB override (cached) → env → (env default).
// Only keys in SETTINGS_REGISTRY are overridable. Security/bootstrap-critical
// values (ENCRYPTION_KEY, JWT_SECRET, MONGODB_URI, REDIS_*) are intentionally
// absent and remain env-only.
//
// The cache is hydrated once at boot and refreshed on every write. Because the
// prod worker runs in-process with the API, a write is visible immediately; for
// a separate worker process the orchestrator also re-hydrates at the start of
// each meeting job, so a change always applies to the next meeting.

export type SettingType = "string" | "number" | "enum";

export interface SettingDef {
  key: string;
  group: string;
  label: string;
  isSecret: boolean;
  type: SettingType;
  options?: readonly string[];
  help?: string;
  // True when a live "Test connection" check is implemented for this key
  // (see settingTesters). Must stay in sync with the TESTERS map.
  testable?: boolean;
}

export const SETTINGS_REGISTRY: readonly SettingDef[] = [
  {
    key: "SARVAM_API_KEY",
    group: "Transcription",
    label: "Sarvam API key",
    isSecret: true,
    type: "string",
    testable: true,
    help: "Sarvam Saarika speech-to-text key (sk_…). Applies to the next meeting."
  },
  {
    key: "TRANSCRIPTION_PROVIDER",
    group: "Transcription",
    label: "Transcription provider",
    isSecret: false,
    type: "enum",
    options: ["auto", "sarvam", "whisper", "language"]
  },
  {
    key: "AZURE_OPENAI_API_KEY",
    group: "AI (Azure OpenAI)",
    label: "Azure OpenAI API key",
    isSecret: true,
    type: "string",
    help: "Key for summaries / minutes generation (and Azure Whisper if used). Endpoint + deployments stay in env."
  },
  {
    key: "ZOOM_ACCOUNT_ID",
    group: "Zoom",
    label: "Zoom account ID",
    isSecret: false,
    type: "string",
    help: "Server-to-server OAuth account ID for Zoom cloud-recording fetch."
  },
  {
    key: "ZOOM_CLIENT_ID",
    group: "Zoom",
    label: "Zoom client ID",
    isSecret: false,
    type: "string"
  },
  {
    key: "ZOOM_CLIENT_SECRET",
    group: "Zoom",
    label: "Zoom client secret",
    isSecret: true,
    type: "string",
    testable: true,
    help: "Tests the full Zoom credential set (account ID + client ID + secret) by fetching a token."
  },
  {
    key: "GOOGLE_OAUTH_CLIENT_SECRET",
    group: "Google",
    label: "Google OAuth client secret",
    isSecret: true,
    type: "string",
    help: "Rotate the secret on the SAME Google OAuth client — existing calendar connections keep working. Do NOT change the client ID here (that needs a separate migration)."
  },
  {
    key: "TEAMS_GRAPH_CLIENT_SECRET",
    group: "Microsoft Teams",
    label: "Teams Graph client secret",
    isSecret: true,
    type: "string",
    help: "Used for Teams transcript fetch (and as the legacy MS-calendar app). Rotate on the SAME Entra app — refresh tokens survive a secret roll."
  },
  {
    key: "MS_CALENDAR_CLIENT_SECRET",
    group: "Microsoft Calendar",
    label: "MS Calendar client secret",
    isSecret: true,
    type: "string",
    help: "Dedicated calendar app (work + personal accounts). Rotate on the SAME Entra app — existing calendar connections survive. Changing the app/client ID would break them."
  },
  {
    key: "BOT_AUTO_LEAVE_WHEN_ALONE_MS",
    group: "Bot behaviour",
    label: "Auto-leave when alone (ms)",
    isSecret: false,
    type: "number",
    help: "Leave this long after every other participant has left."
  },
  {
    key: "BOT_AUTO_LEAVE_WHEN_IDLE_MS",
    group: "Bot behaviour",
    label: "Auto-leave when silent (ms)",
    isSecret: false,
    type: "number",
    help: "Leave after this much silence (no new captions)."
  },
  {
    key: "BOT_NO_SHOW_TIMEOUT_MS",
    group: "Bot behaviour",
    label: "No-show timeout (ms)",
    isSecret: false,
    type: "number",
    help: "Leave if no other participant ever joins within this window."
  },
  {
    key: "JOIN_TIMEOUT_MS",
    group: "Bot behaviour",
    label: "Join timeout (ms)",
    isSecret: false,
    type: "number",
    help: "Give up trying to join/admit after this long."
  },
  {
    key: "MAX_MEETING_SECONDS",
    group: "Bot behaviour",
    label: "Max meeting length (seconds)",
    isSecret: false,
    type: "number",
    help: "Hard cap on how long the bot stays in a meeting."
  }
];

const BY_KEY = new Map(SETTINGS_REGISTRY.map((d) => [d.key, d]));

export function isManagedKey(key: string): boolean {
  return BY_KEY.has(key);
}
export function getSettingDef(key: string): SettingDef | undefined {
  return BY_KEY.get(key);
}

// key -> decrypted DB override value (raw string). Absent = no override.
const cache = new Map<string, string>();

export async function hydrateRuntimeConfig(): Promise<void> {
  try {
    const docs = await SettingModel.find().lean();
    cache.clear();
    for (const d of docs) {
      if (!BY_KEY.has(d.key)) continue; // ignore stale/removed keys
      try {
        cache.set(d.key, decryptSecret(d.valueEncrypted));
      } catch {
        logger.warn({ key: d.key }, "runtime config: failed to decrypt value; ignoring override");
      }
    }
    logger.info({ overrides: cache.size }, "runtime config hydrated");
  } catch (error) {
    logger.warn({ err: error }, "runtime config hydrate failed; using env only");
  }
}

function envValue(key: string): string | undefined {
  const v = (env as unknown as Record<string, unknown>)[key];
  return v === undefined || v === null ? undefined : String(v);
}

function raw(key: string): string | undefined {
  return cache.has(key) ? cache.get(key) : envValue(key);
}

/** Resolve a managed key as a string (DB override → env). */
export function cfgString(key: string): string | undefined {
  return raw(key);
}

/** Resolve a managed key as a number (DB override → env); undefined if unparseable. */
export function cfgNumber(key: string): number | undefined {
  const r = raw(key);
  if (r === undefined) return undefined;
  const n = Number(r);
  return Number.isFinite(n) ? n : undefined;
}

export function isOverridden(key: string): boolean {
  return cache.has(key);
}

/** Upsert an override, encrypt at rest, and refresh the in-process cache. */
export async function setRuntimeConfig(key: string, value: string, adminId?: string): Promise<void> {
  const def = BY_KEY.get(key);
  if (!def) throw new Error(`unknown setting key: ${key}`);
  await SettingModel.findOneAndUpdate(
    { key },
    { $set: { valueEncrypted: encryptSecret(value), isSecret: def.isSecret, updatedBy: adminId } },
    { upsert: true }
  );
  cache.set(key, value);
}

/** Remove an override so the key reverts to its env/default value. */
export async function clearRuntimeConfig(key: string): Promise<void> {
  await SettingModel.deleteOne({ key });
  cache.delete(key);
}

export interface SettingView {
  key: string;
  group: string;
  label: string;
  isSecret: boolean;
  type: SettingType;
  options?: readonly string[];
  help?: string;
  testable: boolean;
  isSet: boolean;
  source: "db" | "env";
  // Secrets: only last4 is ever exposed. Non-secrets: the resolved value.
  last4?: string;
  value?: string;
}

/** Masked snapshot for the admin Settings UI. NEVER returns a secret's value. */
export function describeSettings(): SettingView[] {
  return SETTINGS_REGISTRY.map((def) => {
    const val = raw(def.key);
    const isSet = val !== undefined && val !== "";
    const base = {
      key: def.key,
      group: def.group,
      label: def.label,
      isSecret: def.isSecret,
      type: def.type,
      options: def.options,
      help: def.help,
      testable: Boolean(def.testable),
      isSet,
      source: (cache.has(def.key) ? "db" : "env") as "db" | "env"
    };
    if (def.isSecret) {
      return { ...base, last4: isSet ? String(val).slice(-4) : undefined };
    }
    return { ...base, value: isSet ? val : undefined };
  });
}
