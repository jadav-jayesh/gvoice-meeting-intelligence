import { readFile } from "node:fs/promises";
import { env } from "../../config/env";
import { logger as rootLogger } from "../../utils/logger";
import { withRetry } from "../../utils/resilience";
import type { DiarizationResult, DiarizationSpan } from "../types";
import type { Logger } from "pino";

interface RawSpan {
  speaker?: string | number;
  label?: string | number;
  start?: number;
  end?: number;
  start_time?: number;
  end_time?: number;
}

interface RawDiarizationResponse {
  diarization?: RawSpan[];
  segments?: RawSpan[];
  speakers?: RawSpan[];
  num_speakers?: number;
}

/**
 * Client for the local Pyannote diarization bridge (a small FastAPI service in
 * bridge/pyannote). Uploads the meeting audio and returns stable speaker spans
 * ("SPEAKER_00" … ) that the merge layer uses to attribute Whisper words.
 *
 * Diarization is best-effort: if the bridge is disabled or unreachable the
 * provider returns an empty result so the caller can degrade gracefully
 * (single-speaker transcript) rather than failing the whole meeting.
 */
export class PyannoteDiarizationProvider {
  private readonly log: Logger;

  constructor(logger: Logger = rootLogger) {
    this.log = logger;
  }

  isEnabled(): boolean {
    return env.PYANNOTE_ENABLED;
  }

  async diarize(audioPath: string): Promise<DiarizationResult> {
    if (!this.isEnabled()) {
      this.log.info("pyannote diarization disabled; returning no speaker spans");
      return { spans: [], speakerCount: 0 };
    }

    const buffer = await readFile(audioPath);

    const raw = await withRetry<RawDiarizationResponse>(
      async () => {
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(buffer)], { type: "audio/wav" }), "audio.wav");

        const response = await fetch(env.PYANNOTE_DIARIZATION_URL, {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(env.PYANNOTE_TIMEOUT_MS)
        });

        const body = await response.text();
        if (!response.ok) {
          throw new Error(`Pyannote diarization failed with ${response.status}: ${body.slice(0, 500)}`);
        }
        return body ? (JSON.parse(body) as RawDiarizationResponse) : {};
      },
      {
        attempts: env.PYANNOTE_RETRY_ATTEMPTS,
        baseDelayMs: env.PYANNOTE_RETRY_DELAY_MS,
        label: "pyannote diarization",
        logger: this.log,
        isRetryable: isRetryablePyannoteError
      }
    );

    const spans = parseDiarization(raw);
    const speakerCount = raw.num_speakers ?? new Set(spans.map((span) => span.speaker)).size;
    this.log.info({ spanCount: spans.length, speakerCount }, "pyannote diarization complete");
    return { spans, speakerCount, raw };
  }
}

/** Normalise the bridge's response (several accepted shapes) into ordered spans. */
export function parseDiarization(raw: RawDiarizationResponse): DiarizationSpan[] {
  const source = raw.diarization ?? raw.segments ?? raw.speakers ?? [];
  return source
    .map((span) => {
      const start = numberOr(span.start, span.start_time);
      const end = numberOr(span.end, span.end_time);
      return {
        speaker: normalizeSpeakerLabel(span.speaker ?? span.label),
        start,
        end
      };
    })
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function normalizeSpeakerLabel(raw: string | number | undefined): string {
  if (raw === undefined || raw === null || String(raw).trim() === "") return "SPEAKER_00";
  const value = String(raw).trim();
  // Bare numeric labels (0, "1") → SPEAKER_0N to match pyannote's convention.
  if (/^\d+$/.test(value)) return `SPEAKER_${value.padStart(2, "0")}`;
  return value;
}

function numberOr(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function isRetryablePyannoteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLocaleLowerCase("en-US") : String(error).toLocaleLowerCase("en-US");
  return (
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("enotfound") ||
    message.includes("socket hang up") ||
    message.includes("timeout") ||
    message.includes("429") ||
    /\bwith 5\d\d\b/.test(message)
  );
}
