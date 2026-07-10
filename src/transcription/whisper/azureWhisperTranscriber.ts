import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { env } from "../../config/env";
import { cfgString } from "../../config/runtimeConfig";
import { extractAudioSegment, probeDurationSeconds } from "../../media/ffmpeg";
import { logger as rootLogger } from "../../utils/logger";
import { parseRetryAfterMs, withRetry } from "../../utils/resilience";
import type { WhisperResult, WhisperSegment, WhisperWord } from "../types";
import type { Logger } from "pino";

interface RawWhisperWord {
  word?: string;
  text?: string;
  start?: number;
  end?: number;
}

interface RawWhisperSegment {
  id?: number;
  text?: string;
  start?: number;
  end?: number;
  avg_logprob?: number;
  no_speech_prob?: number;
}

interface RawWhisperResponse {
  text?: string;
  language?: string;
  duration?: number;
  words?: RawWhisperWord[];
  segments?: RawWhisperSegment[];
}

export interface WhisperTranscribeOptions {
  // Override the configured auto/forced language for this call. Per-region
  // decoding deliberately passes nothing so each region auto-detects.
  language?: string;
  // Override the configured prompt. Defaults to env.WHISPER_PROMPT (empty).
  prompt?: string;
  signal?: AbortSignal;
}

/**
 * Azure OpenAI Whisper client returning `verbose_json` with word-level
 * timestamps. Two entry points:
 *
 *  - {@link transcribeFile} — whole-file decode, auto-chunked when the audio
 *    exceeds Azure's ~25MB upload cap.
 *  - {@link transcribeRegion} — decode a single [start,end] slice with all
 *    timestamps offset back onto the full-meeting timeline. Used by the
 *    per-speaker-region pipeline so each speaker keeps their own language.
 *
 * Configuration falls back to the shared AZURE_OPENAI_* values when the
 * WHISPER_* overrides are blank, so one Azure resource can serve chat + Whisper.
 */
export class AzureWhisperTranscriber {
  private readonly log: Logger;

  constructor(logger: Logger = rootLogger) {
    this.log = logger;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey() && (this.endpointOverride() || (env.AZURE_OPENAI_ENDPOINT && this.deployment())));
  }

  assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new Error(
        "Azure Whisper is not configured. Set WHISPER_ENDPOINT (or AZURE_OPENAI_TRANSCRIPTION_ENDPOINT), WHISPER_API_KEY (or AZURE_OPENAI_API_KEY), and a deployment."
      );
    }
  }

  /** Transcribe a whole audio file, chunking by time if it is too large to upload. */
  async transcribeFile(audioPath: string, options: WhisperTranscribeOptions = {}): Promise<WhisperResult> {
    this.assertConfigured();
    const { size } = await stat(audioPath);
    if (size <= env.WHISPER_MAX_UPLOAD_BYTES) {
      const buffer = await readFile(audioPath);
      return this.transcribeBuffer(buffer, 0, options);
    }

    this.log.info({ audioPath, size, cap: env.WHISPER_MAX_UPLOAD_BYTES }, "audio exceeds Whisper upload cap; chunking by time");
    return this.transcribeInChunks(audioPath, options);
  }

  /**
   * Transcribe a [startSeconds, endSeconds] window. The slice is decoded in
   * isolation (auto-language unless overridden) and every timestamp is shifted
   * by `startSeconds` so it lines up with the full meeting.
   */
  async transcribeRegion(
    audioPath: string,
    startSeconds: number,
    endSeconds: number,
    options: WhisperTranscribeOptions = {}
  ): Promise<WhisperResult> {
    this.assertConfigured();
    const workDir = await mkdtemp(path.join(tmpdir(), "whisper-region-"));
    const slicePath = path.join(workDir, "region.wav");
    try {
      const ok = await extractAudioSegment(audioPath, startSeconds, endSeconds, slicePath);
      if (!ok) return emptyResult(startSeconds);
      const buffer = await readFile(slicePath);
      if (buffer.byteLength === 0) return emptyResult(startSeconds);
      return await this.transcribeBuffer(buffer, startSeconds, options);
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async transcribeInChunks(audioPath: string, options: WhisperTranscribeOptions): Promise<WhisperResult> {
    const duration = await probeDurationSeconds(audioPath);
    if (duration <= 0) return emptyResult(0);

    const chunk = env.WHISPER_CHUNK_SECONDS;
    const results: WhisperResult[] = [];
    for (let start = 0; start < duration; start += chunk) {
      const end = Math.min(duration, start + chunk);
      // Each chunk goes through transcribeRegion so timestamps are offset and
      // the temporary slice is cleaned up.
      results.push(await this.transcribeRegion(audioPath, start, end, options));
    }
    return mergeWhisperResults(results);
  }

  private async transcribeBuffer(buffer: Buffer, offsetSeconds: number, options: WhisperTranscribeOptions): Promise<WhisperResult> {
    const url = this.transcriptionUrl();
    const language = options.language ?? (env.WHISPER_LANGUAGE || undefined);
    const prompt = options.prompt ?? (env.WHISPER_PROMPT || undefined);

    const raw = await withRetry<RawWhisperResponse>(
      async () => {
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(buffer)], { type: "audio/wav" }), "audio.wav");
        form.append("response_format", "verbose_json");
        form.append("timestamp_granularities[]", "word");
        form.append("timestamp_granularities[]", "segment");
        form.append("temperature", String(env.WHISPER_TEMPERATURE));
        if (language) form.append("language", language);
        if (prompt) form.append("prompt", prompt);

        const response = await fetch(url, {
          method: "POST",
          headers: { "api-key": this.apiKey() as string },
          body: form,
          signal: options.signal ?? AbortSignal.timeout(env.WHISPER_TIMEOUT_MS)
        });

        const body = await response.text();
        if (!response.ok) {
          const retryAfter = response.headers.get("retry-after-ms") ?? response.headers.get("retry-after");
          throw new Error(`Azure Whisper failed with ${response.status}${retryAfter ? ` (retry-after: ${retryAfter})` : ""}: ${body.slice(0, 500)}`);
        }
        return body ? (JSON.parse(body) as RawWhisperResponse) : {};
      },
      {
        attempts: env.WHISPER_RETRY_ATTEMPTS,
        baseDelayMs: env.WHISPER_RETRY_DELAY_MS,
        label: "azure whisper transcription",
        logger: this.log,
        isRetryable: isRetryableWhisperError,
        retryAfterMs: (error) => parseRetryAfterMs(error)
      }
    );

    return parseVerboseJson(raw, offsetSeconds);
  }

  private apiKey(): string | undefined {
    return env.WHISPER_API_KEY || env.AZURE_WHISPER_API_KEY || cfgString("AZURE_OPENAI_API_KEY");
  }

  private deployment(): string | undefined {
    return env.WHISPER_DEPLOYMENT || env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT;
  }

  // A complete transcription endpoint URL, if one is configured directly
  // (WHISPER_ENDPOINT, the AZURE_WHISPER_ENDPOINT alias, or the shared Azure
  // transcription endpoint). Returns undefined when only a base + deployment
  // are available and the URL must be composed.
  private endpointOverride(): string | undefined {
    return env.WHISPER_ENDPOINT || env.AZURE_WHISPER_ENDPOINT || env.AZURE_OPENAI_TRANSCRIPTION_ENDPOINT;
  }

  private transcriptionUrl(): string {
    const override = this.endpointOverride();
    if (override) return override;
    const base = env.AZURE_OPENAI_ENDPOINT?.replace(/\/+$/g, "");
    const apiVersion = env.WHISPER_API_VERSION || env.AZURE_OPENAI_API_VERSION;
    return `${base}/openai/deployments/${encodeURIComponent(this.deployment() as string)}/audio/transcriptions?api-version=${encodeURIComponent(apiVersion)}`;
  }
}

/** A Whisper result carries no usable speech (used to trigger rescue/fallback). */
export function isWhisperResultEmpty(result: WhisperResult): boolean {
  return result.text.trim().length === 0 && result.words.length === 0 && result.segments.length === 0;
}

export function parseVerboseJson(raw: RawWhisperResponse, offsetSeconds = 0): WhisperResult {
  const words: WhisperWord[] = (raw.words ?? [])
    .map((word) => ({
      word: (word.word ?? word.text ?? "").trim(),
      start: numberOr(word.start) + offsetSeconds,
      end: numberOr(word.end, word.start) + offsetSeconds
    }))
    .filter((word) => word.word.length > 0 && word.end >= word.start);

  const segments: WhisperSegment[] = (raw.segments ?? [])
    .map((segment, index) => ({
      id: segment.id ?? index,
      text: (segment.text ?? "").trim(),
      start: numberOr(segment.start) + offsetSeconds,
      end: numberOr(segment.end, segment.start) + offsetSeconds,
      avgLogprob: typeof segment.avg_logprob === "number" ? segment.avg_logprob : undefined,
      noSpeechProb: typeof segment.no_speech_prob === "number" ? segment.no_speech_prob : undefined
    }))
    .filter((segment) => segment.text.length > 0 && segment.end >= segment.start);

  return {
    text: (raw.text ?? "").trim(),
    language: normalizeLanguage(raw.language),
    words,
    segments,
    offsetSeconds,
    raw
  };
}

/** Merge several Whisper results (already timestamp-offset) into one timeline. */
export function mergeWhisperResults(results: WhisperResult[]): WhisperResult {
  const usable = results.filter((result) => !isWhisperResultEmpty(result));
  if (usable.length === 0) return emptyResult(0);

  const words = usable.flatMap((result) => result.words).sort((a, b) => a.start - b.start);
  const segments = usable.flatMap((result) => result.segments).sort((a, b) => a.start - b.start);
  return {
    text: usable.map((result) => result.text).filter(Boolean).join(" ").trim(),
    language: pickDominantLanguage(usable),
    words,
    segments,
    offsetSeconds: 0,
    raw: usable.map((result) => result.raw)
  };
}

function emptyResult(offsetSeconds: number): WhisperResult {
  return { text: "", language: undefined, words: [], segments: [], offsetSeconds, raw: undefined };
}

function pickDominantLanguage(results: WhisperResult[]): string | undefined {
  const weights = new Map<string, number>();
  for (const result of results) {
    if (!result.language) continue;
    const span = result.segments.reduce((total, segment) => total + (segment.end - segment.start), 0) || 1;
    weights.set(result.language, (weights.get(result.language) ?? 0) + span);
  }
  let best: string | undefined;
  let bestWeight = -1;
  for (const [language, weight] of weights) {
    if (weight > bestWeight) {
      best = language;
      bestWeight = weight;
    }
  }
  return best;
}

function normalizeLanguage(language: string | undefined): string | undefined {
  if (!language) return undefined;
  const trimmed = language.trim().toLocaleLowerCase("en-US");
  // Azure sometimes returns full names ("english") rather than codes.
  const map: Record<string, string> = { english: "en", hindi: "hi", gujarati: "gu", punjabi: "pa", marathi: "mr", urdu: "ur" };
  return map[trimmed] ?? trimmed;
}

function numberOr(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function isRetryableWhisperError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLocaleLowerCase("en-US") : String(error).toLocaleLowerCase("en-US");
  return (
    message.includes("429") ||
    message.includes("too many request") ||
    message.includes("rate limit") ||
    message.includes("retry-after") ||
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("socket hang up") ||
    message.includes("timeout") ||
    /\bwith 5\d\d\b/.test(message)
  );
}
