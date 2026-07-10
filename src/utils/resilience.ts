import type { Logger } from "pino";

export interface RetryOptions {
  attempts: number;
  // Base delay for exponential backoff (ms). Actual delay is
  // baseDelayMs * 2^(attempt-1) plus full jitter.
  baseDelayMs: number;
  // Upper bound for any single sleep, including a server-provided Retry-After.
  maxDelayMs?: number;
  label: string;
  logger?: Logger;
  // Decide whether a thrown error is worth retrying. Defaults to "retry once
  // for anything" — callers should narrow this to transient errors.
  isRetryable?: (error: unknown) => boolean;
  // Extract a server-mandated wait (ms) from an error, e.g. a 429 Retry-After
  // header surfaced on the error message. Honoured over computed backoff.
  retryAfterMs?: (error: unknown) => number | undefined;
}

/**
 * Runs `task`, retrying transient failures with exponential backoff + full
 * jitter. When the error carries a server-mandated Retry-After (e.g. Azure
 * Whisper's S0 tier returns 429 "retry after N seconds"), that wait is honoured
 * instead of the computed backoff so bursts of per-region calls don't get
 * dropped. The last error is rethrown once attempts are exhausted.
 */
export async function withRetry<T>(task: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const { attempts, baseDelayMs, label, logger } = options;
  const maxDelayMs = options.maxDelayMs ?? 65_000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      const retryable = options.isRetryable ? options.isRetryable(error) : true;
      if (attempt >= attempts || !retryable) break;

      const serverWait = options.retryAfterMs?.(error);
      const backoff = baseDelayMs * 2 ** (attempt - 1);
      const jittered = backoff + Math.random() * backoff;
      const delayMs = Math.min(maxDelayMs, serverWait ?? jittered);

      logger?.warn(
        { attempt, attempts, retryInMs: Math.round(delayMs), serverDirected: serverWait !== undefined, label, err: error },
        `${label} failed; retrying`
      );
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${label} failed: ${String(lastError)}`);
}

/** Parse a Retry-After value (seconds, ms, or HTTP date) out of an error/text. */
export function parseRetryAfterMs(error: unknown, maxMs = 65_000): number | undefined {
  const message = error instanceof Error ? error.message : String(error ?? "");
  // "retry-after-ms: 1234" or "retryAfterMs":1234
  const msMatch = message.match(/retry[-_ ]?after[-_ ]?ms["':\s]+(\d+)/i);
  if (msMatch) return clampPositive(Number(msMatch[1]), maxMs);
  // "retry after 12 seconds" / "Retry-After: 12"
  const secMatch = message.match(/retry[-_ ]?after["':\s]+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds)?/i);
  if (secMatch) return clampPositive(Number(secMatch[1]) * 1000, maxMs);
  return undefined;
}

function clampPositive(value: number, maxMs: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(value, maxMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
