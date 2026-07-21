import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const rawEnv = { ...process.env };
if (rawEnv.AZURE_STORAGE_CONTAINER_NAME && !rawEnv.AZURE_STORAGE_CONTAINER) {
  rawEnv.AZURE_STORAGE_CONTAINER = rawEnv.AZURE_STORAGE_CONTAINER_NAME;
}

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLocaleLowerCase("en-US");
    if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "off", ""].includes(normalized)) return false;
  }
  return value;
}, z.boolean());

const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().url().optional()
);

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default("info"),

  MONGODB_URI: z.string().default("mongodb://127.0.0.1:27017/gvoice_meeting_intelligence"),

  // Auth — JWT signed cookie. JWT_SECRET must be set in production; the
  // default below is *only* for local development so the server still boots.
  // SameSite=None + Secure cookies require HTTPS in production (browsers
  // accept Secure cookies on http://localhost as a special case).
  JWT_SECRET: z.string().min(32).default("dev-only-secret-change-me-please-32chars+"),
  // Short-lived access token. Kept brief because a stolen access token can be
  // used directly until it expires; the refresh token below mints fresh ones
  // silently so the user never sees an interruption.
  JWT_EXPIRES_IN: z.string().default("15m"),
  // Long-lived refresh token. The SPA stays signed in as long as the user
  // visits within this window.
  REFRESH_TOKEN_EXPIRES_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_DOMAIN: z.string().optional(),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),

  REDIS_HOST: z.string().default("127.0.0.1"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  // Azure Cache for Redis requires TLS (port 6380). ioredis needs the tls option
  // with servername set to the host, or the connection silently hangs on the
  // TLS port. Off by default for local plaintext Redis.
  REDIS_TLS: booleanFromEnv.default(false),
  BOT_QUEUE_NAME: z.string().default("gvoice-meeting-bots"),
  BOT_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(1),
  RUN_WORKER_IN_API: booleanFromEnv.default(true),

  BROWSER_HEADLESS: booleanFromEnv.default(false),
  BROWSER_WIDTH: z.coerce.number().int().positive().default(1920),
  BROWSER_HEIGHT: z.coerce.number().int().positive().default(1080),
  BROWSER_CHANNEL: z.string().default("chromium"),
  BROWSER_COLOR_SCHEME: z.enum(["light", "dark", "no-preference"]).default("dark"),
  BOT_DISPLAY_NAME: z.string().default("gVoice"),
  MAX_MEETING_SECONDS: z.coerce.number().positive().default(14400),
  JOIN_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),
  CAPTURE_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  PARTICIPANT_PANEL_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
  BOT_AUTO_LEAVE_WHEN_ALONE_MS: z.coerce.number().int().min(0).default(20000),
  // Leave when the meeting has gone silent for this long — no new captions
  // accepted while participants linger idle after the conversation wrapped up.
  // Only armed once at least one caption has been seen (so a failed-captions
  // session never triggers it). 0 disables. Default 8 minutes is conservative
  // enough to ride out normal pauses.
  BOT_AUTO_LEAVE_WHEN_IDLE_MS: z.coerce.number().int().min(0).default(480000),
  // Leave when the bot has been admitted but NO other participant has ever
  // appeared for this long — a ghost meeting nobody joined. Distinct from the
  // alone-timer (which only arms after someone was seen and then left) and the
  // idle-timer (which needs a caption first); without this guard an empty room
  // would hold the bot until MAX_MEETING_SECONDS. Timer is measured from the
  // moment the bot is admitted, so late joiners up to this window are still
  // captured. 0 disables. Default 8 minutes.
  BOT_NO_SHOW_TIMEOUT_MS: z.coerce.number().int().min(0).default(480000),
  GOOGLE_USER_DATA_DIR: z.string().default(".data/browser-profiles/google"),
  TEAMS_USER_DATA_DIR: z.string().default(".data/browser-profiles/teams"),
  TEAMS_AUDIO_MODE: z.enum(["computer", "none"]).default("computer"),
  TEAMS_MODE: z.enum(["graph_transcript", "browser_live", "hybrid"]).default("hybrid"),
  TEAMS_BOT_APP_ID: z.string().optional(),
  TEAMS_BOT_APP_PASSWORD: z.string().optional(),
  TEAMS_BOT_TENANT_ID: z.string().optional(),
  TEAMS_BOT_ENABLED: booleanFromEnv.default(false),
  TEAMS_GRAPH_TENANT_ID: z.string().optional(),
  TEAMS_GRAPH_CLIENT_ID: z.string().optional(),
  TEAMS_GRAPH_CLIENT_SECRET: z.string().optional(),
  TEAMS_GRAPH_USER_ID: z.string().optional(),
  TEAMS_GRAPH_TRANSCRIPT_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  TEAMS_GRAPH_TRANSCRIPT_TIMEOUT_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  TEAMS_GRAPH_TRANSCRIPT_RETRY_DELAYS_MS: z.string().default("300000,600000,1200000,1800000,3600000"),
  TEAMS_GRAPH_TRANSCRIPT_MAX_RETRY_ATTEMPTS: z.coerce.number().int().positive().default(5),

  // ── Calendar auto-join (per-user "Connect calendar" OAuth) ────────────────
  // Users self-connect Google/Microsoft calendars; a poller discovers their
  // upcoming meetings and a scheduler sends the bot at start time. Google needs
  // its OWN OAuth web client. Microsoft REUSES the existing Graph app
  // (TEAMS_GRAPH_CLIENT_ID/SECRET) — we only add the delegated auth-code flow,
  // so just the redirect URI + tenant mode live here.
  CALENDAR_AUTO_JOIN_ENABLED: booleanFromEnv.default(false),
  // Google OAuth web client (Google Cloud Console → Credentials → OAuth client).
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().default("http://localhost:3000/api/calendar/google/callback"),
  // Microsoft delegated OAuth. "common" makes the app multi-tenant so any org's
  // users can connect. By default this falls back to the Teams Graph app
  // (TEAMS_GRAPH_CLIENT_ID/SECRET), which is registered work/school-only and so
  // rejects personal Microsoft accounts ("can't sign in with a personal
  // account"). Set MS_CALENDAR_CLIENT_ID/SECRET to a SEPARATE app registered as
  // "Any org directory + personal Microsoft accounts" (delegated-only) to also
  // allow personal Outlook accounts. When set, calendar OAuth uses it instead;
  // the Teams transcript path keeps using TEAMS_GRAPH_* untouched.
  MS_CALENDAR_CLIENT_ID: z.string().optional(),
  MS_CALENDAR_CLIENT_SECRET: z.string().optional(),
  MS_OAUTH_REDIRECT_URI: z.string().default("http://localhost:3000/api/calendar/microsoft/callback"),
  MS_OAUTH_TENANT: z.string().default("common"),
  // Encrypts refresh tokens at rest (AES-256-GCM). 32+ chars; required in prod.
  ENCRYPTION_KEY: z.string().min(32).default("dev-only-encryption-key-change-me-32+chars"),
  // Scheduler knobs.
  CALENDAR_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  CALENDAR_LOOKAHEAD_HOURS: z.coerce.number().int().positive().default(48),
  CALENDAR_JOIN_LEAD_SECONDS: z.coerce.number().int().min(0).max(1800).default(60),

  ZOOM_USER_DATA_DIR: z.string().default(".data/browser-profiles/zoom"),
  ZOOM_MODE: z.enum(["cloud_transcript", "browser_live", "hybrid"]).default("hybrid"),
  ZOOM_ACCOUNT_ID: z.string().optional(),
  ZOOM_CLIENT_ID: z.string().optional(),
  ZOOM_CLIENT_SECRET: z.string().optional(),
  ZOOM_OAUTH_BASE_URL: z.string().default("https://zoom.us"),
  ZOOM_API_BASE_URL: z.string().default("https://api.zoom.us/v2"),
  ZOOM_TRANSCRIPT_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  ZOOM_TRANSCRIPT_TIMEOUT_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  ZOOM_TRANSCRIPT_RETRY_DELAYS_MS: z.string().default("300000,600000,1200000,1800000,3600000"),
  ZOOM_TRANSCRIPT_MAX_RETRY_ATTEMPTS: z.coerce.number().int().positive().default(5),

  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  AUDIO_CAPTURE_DRIVER: z.enum(["pulse", "alsa", "avfoundation", "dshow", "none"]).default("pulse"),
  AUDIO_CAPTURE_SOURCE: z.string().default("default"),
  AUDIO_CAPTURE_ENABLED: booleanFromEnv.default(true),
  AUDIO_CAPTURE_PER_SESSION_SINK: booleanFromEnv.default(true),
  BROWSER_PROFILE_PER_SESSION: booleanFromEnv.default(true),
  RECORDING_DIR: z.string().default(".data/sessions"),
  PRE_JOIN_TRIM_PADDING_SECONDS: z.coerce.number().min(0).default(1.5),

  AZURE_STORAGE_CONNECTION_STRING: z.string().optional(),
  AZURE_STORAGE_CONTAINER: z.string().default("meeting-artifacts"),
  AZURE_STORAGE_CONTAINER_NAME: z.string().optional(),
  AZURE_STORAGE_BASE_PATH: z.string().default("gVoice"),
  // TTL for the read-only SAS tokens minted when serving recording/thumbnail
  // URLs. The token is re-signed on every API request, so this only needs to
  // outlast a single viewing/playback session — 24h is comfortable.
  AZURE_STORAGE_SAS_EXPIRES_HOURS: z.coerce.number().positive().default(24),

  AZURE_OPENAI_ENDPOINT: z.string().optional(),
  AZURE_OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_API_VERSION: z.string().default("2024-10-21"),
  AZURE_OPENAI_CHAT_DEPLOYMENT: z.string().optional(),
  AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT: z.string().optional(),
  AZURE_OPENAI_SUMMARY_ENDPOINT: optionalUrl,
  AZURE_OPENAI_TRANSCRIPTION_ENDPOINT: optionalUrl,
  AZURE_OPENAI_SUMMARY_MODEL: z.string().optional(),
  AZURE_OPENAI_SUMMARY_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  AZURE_OPENAI_RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  AZURE_OPENAI_RETRY_DELAY_MS: z.coerce.number().int().min(250).max(120000).default(5000),
  // Segments per per-segment-sentiment batch. Keeps each AI call's input+output
  // bounded so long meetings don't blow the rate/token limit. Lower = safer on a
  // low-TPM deployment; higher = fewer calls.
  SUMMARY_SENTIMENT_BATCH_SIZE: z.coerce.number().int().min(20).max(400).default(120),

  SARVAM_API_KEY: z.string().optional(),
  SARVAM_DIARIZATION_URL: z.string().optional(),
  SARVAM_LANGUAGE_CODE: z.string().default("unknown"),
  // When SARVAM_LANGUAGE_CODE is "unknown", detect the REAL spoken language from
  // a short sample before the full transcription (Sarvam's own auto-detect keeps
  // mislabelling code-mixed Indic audio as English → romanised output). Off by
  // default; enable per deployment. Falls back to "unknown" for English/low
  // confidence, so it never harms English meetings.
  SARVAM_AUTO_DETECT_LANGUAGE: booleanFromEnv.default(false),
  // Candidate Sarvam language codes tried during auto-detect disambiguation.
  // When the default detector produces Indic-script text (so the audio is an
  // Indian language, but possibly the WRONG one — e.g. Gujarati misread as
  // Marathi), the sample is transcribed under each candidate and a model picks
  // the one that reads as coherent words. Comma-separated; the default covers
  // this deployment's Gujarati/Hindi/Marathi mix.
  SARVAM_LANGUAGE_CANDIDATES: z.string().default("gu-IN,hi-IN,mr-IN"),
  // STT model for the Sarvam batch job. "saarika:v2.5" transcribes in the
  // spoken language (native script — the default we want). "saaras:v3" is the
  // translation/codemix model that emits English; set the model+mode env for
  // that. Switching native vs translated is config, not a code change.
  SARVAM_STT_MODEL: z.string().default("saarika:v2.5"),
  // Only applies to saaras:v3 (transcribe|translate|verbatim|translit|codemix).
  // Empty/unset means "send no mode" — required for saarika, which rejects it.
  SARVAM_STT_MODE: z.string().optional(),
  SARVAM_RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(8).default(3),
  SARVAM_RETRY_DELAY_MS: z.coerce.number().int().min(250).max(30000).default(2000),

  TRANSCRIPTION_FORCE_PROVIDER: z.enum(["auto", "azure", "sarvam"]).default("auto"),
  ALLOW_MOCK_AI: booleanFromEnv.default(false),
  SPEAKER_MAPPING_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),
  SPEAKER_RESOLVER_ENABLED: booleanFromEnv.default(true),
  SPEAKER_RESOLVER_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),
  // Second-chance threshold: a resolver guess below the hard threshold above is
  // still applied when the participant name it points at is not already claimed
  // by a more confident cluster. Recovers correct-but-unsure names (e.g. a voice
  // the model is 0.62 sure is "Ashok") without letting them steal a name from a
  // cluster that is more certain. Set equal to the hard threshold to disable.
  SPEAKER_RESOLVER_SOFT_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.6),
  ALLOW_LOW_CONFIDENCE_DOMINANCE_MAPPING: booleanFromEnv.default(false),

  // When true, voice clusters with NO verifiable evidence (no active-speaker
  // highlight, no trustworthy captions, no official transcript) are given a real
  // participant name by join/turn order — a guess. Default false: never assume a
  // name. Unverifiable clusters stay honest "Speaker A/B/C" so the transcript
  // never shows a wrong person's name as if it were confirmed. Real names still
  // come from evidence (active-speaker overlap, caption match, Graph transcript).
  SPEAKER_ASSUME_NAMES_BY_ORDER: booleanFromEnv.default(false),

  // ── Provider selection (Sarvam vs. Whisper+Pyannote) ──────────────────────
  // Top-level switch for the new provider architecture. Selection is STRICT —
  // there is NO cross-provider fallback. "auto" preserves the legacy behaviour
  // (Azure/Sarvam auto-routing via TRANSCRIPTION_FORCE_PROVIDER). "sarvam" runs
  // the (untouched) Sarvam flow ONLY (native output, never translated).
  // "whisper" runs the Azure Whisper + Pyannote pipeline ONLY (its output is
  // translated to English downstream for non-English meetings).
  // "language" is the current production mode: detect the meeting language from
  // the AUDIO before transcribing, then route English meetings to Whisper (no
  // translation — English stays English) and non-English (Indic) meetings to
  // Sarvam (native, untranslated). If Whisper fails after its retries — or comes
  // back empty — the English meeting is also handed to Sarvam, so no meeting is
  // ever lost. See audioLanguageProbe.ts + transcriptionService.ts.
  TRANSCRIPTION_PROVIDER: z.enum(["auto", "sarvam", "whisper", "language"]).default("auto"),

  // ── Azure Whisper (verbose_json + word timestamps) ────────────────────────
  // Endpoint/key/deployment default to the shared AZURE_OPENAI_* values when
  // left blank, so a single Azure OpenAI resource serves both chat and Whisper.
  WHISPER_ENDPOINT: optionalUrl,
  WHISPER_API_KEY: z.string().optional(),
  // Back-compat aliases — earlier configs used the AZURE_WHISPER_* names.
  AZURE_WHISPER_ENDPOINT: optionalUrl,
  AZURE_WHISPER_API_KEY: z.string().optional(),
  WHISPER_DEPLOYMENT: z.string().optional(),
  WHISPER_API_VERSION: z.string().optional(),
  // Keep EMPTY by default. A prompt containing Indic sample sentences poisons
  // Whisper into echoing that script as gibberish loops (see memory). Only set
  // a short, neutral, declarative prompt if you know what you are doing.
  WHISPER_PROMPT: z.string().default(""),
  // Leave EMPTY for auto-detect. NEVER force "gu" — Azure Whisper rejects it
  // (unsupported_language). en/hi may be forced if a deployment needs it.
  WHISPER_LANGUAGE: z.string().default(""),
  WHISPER_TEMPERATURE: z.coerce.number().min(0).max(1).default(0),
  WHISPER_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  // 3 attempts per the rate-limit fallback design: once exhausted — typically
  // on an S0-tier 429 under parallel per-region decode — a whisper-mode meeting
  // reroutes to Sarvam (WHISPER_SARVAM_FALLBACK) instead of failing to captions.
  WHISPER_RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(8).default(3),
  // On Whisper rate-limit/transient failure (after the retries above), reroute
  // THIS meeting to Sarvam rather than degrading straight to the caption
  // transcript. A deliberate, gated exception to the otherwise-strict
  // no-cross-provider rule. Sarvam output is native (untranslated); if Sarvam
  // also fails, the orchestrator's caption fallback still applies.
  WHISPER_SARVAM_FALLBACK: booleanFromEnv.default(true),
  WHISPER_RETRY_DELAY_MS: z.coerce.number().int().min(250).max(60000).default(2000),
  // Azure Whisper hard-rejects uploads over ~25MB. Stay just under.
  WHISPER_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(24_000_000),
  WHISPER_CHUNK_SECONDS: z.coerce.number().int().positive().default(600),
  // Per-speaker-region decoding: diarize first, transcribe each contiguous
  // same-speaker region alone with auto-language so every speaker keeps their
  // own language (a whole-file pass forces the whole meeting into the dominant
  // speaker's language and breaks speaker mapping). Default on.
  WHISPER_PER_REGION_DECODE: booleanFromEnv.default(true),
  // Per-speaker regions are each a separate Azure Whisper call. Decoding them
  // one-at-a-time (the old default of 1) was the dominant cost on active
  // multi-speaker meetings. 4 parallel workers cut decode wall-time ~linearly;
  // raise toward 8 if Azure isn't throwing 429s (Retry-After is already honored).
  WHISPER_REGION_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(4),
  // Language routing (TRANSCRIPTION_PROVIDER=language): the meeting language is
  // detected from a short AUDIO sample BEFORE transcription (see
  // audioLanguageProbe.ts). English meetings go to Whisper (no translation);
  // non-English (Indic) meetings go straight to Sarvam for clean untranslated
  // native transcription (Whisper can't do Gujarati). Detection is from audio,
  // not captions, because romanized/absent captions are unreliable for Indic.
  WHISPER_NONENGLISH_TO_SARVAM: booleanFromEnv.default(true),
  // Share of letters in the probe sample that must be Indic script for the
  // meeting to count as non-English (→ Sarvam). Below this it is treated as
  // English (→ Whisper), so a stray Hindi word does not flip a clean English
  // meeting. Used by audioLanguageProbe.detectAudioLanguage.
  WHISPER_NONENGLISH_INDIC_THRESHOLD: z.coerce.number().min(0).max(1).default(0.15),
  // Length (seconds) of the audio sample decoded by the language probe. Kept
  // short so the extra pre-transcription Whisper call is cheap; a single
  // speech-dense window is enough to classify English vs Indic.
  WHISPER_LANGUAGE_PROBE_SECONDS: z.coerce.number().int().min(10).max(600).default(90),

  // Always-succeed policy: a meeting with detected speech but an empty
  // transcript (every transcription engine AND captions exhausted) still
  // completes with whatever was recovered instead of being marked failed.
  // Recording-missing / stopword-participant guards still fail loudly — those
  // are real infra/data bugs, not "the audio couldn't be transcribed".
  ALWAYS_COMPLETE_MEETINGS: booleanFromEnv.default(true),

  // ── Pyannote diarization bridge (local FastAPI service) ───────────────────
  PYANNOTE_ENABLED: booleanFromEnv.default(true),
  PYANNOTE_DIARIZATION_URL: z.string().default("http://127.0.0.1:8001/diarize"),
  PYANNOTE_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),
  PYANNOTE_RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(6).default(2),
  PYANNOTE_RETRY_DELAY_MS: z.coerce.number().int().min(250).max(30000).default(3000),

  // ── Translation layer (non-English → English transcriptText) ──────────────
  // Translation runs ONLY for the whisper provider, only for non-English
  // meetings, and only AFTER speaker mapping/resolution. The Sarvam flow is
  // never translated. Segments are translated in batches, never word-by-word.
  TRANSLATION_ENABLED: booleanFromEnv.default(true),
  TRANSLATION_TARGET_LANGUAGE: z.string().default("en"),
  TRANSLATION_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(40),
  TRANSLATION_MAX_TOKENS: z.coerce.number().int().min(256).max(16000).default(4000),
  // Translate batches concurrently instead of one-after-another. On a long
  // code-mixed meeting this turns a serial chain of GPT round-trips into a few
  // parallel ones. Bounded to avoid Azure OpenAI rate limits.
  TRANSLATION_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4)
});

const parsed = envSchema.safeParse(rawEnv);

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = parsed.data;

// Fail-fast safety net: refuse to boot in production if JWT_SECRET is still
// the dev default. Catches the "forgot to set it" case before any tokens get
// minted with a publicly known secret.
const DEV_JWT_SECRET = "dev-only-secret-change-me-please-32chars+";
if (env.NODE_ENV === "production" && env.JWT_SECRET === DEV_JWT_SECRET) {
  throw new Error(
    "JWT_SECRET is the development default but NODE_ENV=production. Set a unique, random value (try: openssl rand -hex 32)."
  );
}

// Same guard for ENCRYPTION_KEY — it protects stored calendar refresh tokens.
const DEV_ENCRYPTION_KEY = "dev-only-encryption-key-change-me-32+chars";
if (env.NODE_ENV === "production" && env.ENCRYPTION_KEY === DEV_ENCRYPTION_KEY) {
  throw new Error(
    "ENCRYPTION_KEY is the development default but NODE_ENV=production. Set a unique, random value (try: openssl rand -hex 32)."
  );
}

export const redisConnection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  ...(env.REDIS_TLS ? { tls: { servername: env.REDIS_HOST } } : {})
};
