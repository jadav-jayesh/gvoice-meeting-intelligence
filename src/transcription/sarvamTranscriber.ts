import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { SarvamAIClient } from "sarvamai";
import { env } from "../config/env";
import { cfgString } from "../config/runtimeConfig";
import type { DiarizedTranscriptSegment } from "../types/meeting";
import type { Transcriber, TranscriptionResult } from "./types";
import { logger } from "../utils/logger";

interface SarvamSegment {
  speaker?: string;
  speaker_id?: string;
  speakerLabel?: string;
  text?: string;
  transcript?: string;
  start?: number;
  end?: number;
  start_time?: number;
  end_time?: number;
  startTime?: number;
  endTime?: number;
  confidence?: number;
}

interface SarvamResponse {
  language_code?: string;
  language?: string;
  text?: string;
  transcript?: string;
  segments?: SarvamSegment[];
  diarized_transcript?: SarvamSegment[];
  diarizedTranscript?: SarvamSegment[];
  diarized_transcript_entries?: SarvamSegment[];
  diarized_entries?: SarvamSegment[];
  diarized_transcript_result?: {
    entries?: SarvamJobEntry[];
  };
}

interface SarvamJobResponse {
  language_code?: string;
  transcript?: string;
  diarized_transcript?: {
    entries?: SarvamJobEntry[];
  };
}

interface SarvamJobEntry {
  speaker_id?: string | number;
  speaker?: string;
  transcript?: string;
  text?: string;
  start_time?: number;
  end_time?: number;
  start_time_seconds?: number;
  end_time_seconds?: number;
}

export class SarvamTranscriber implements Transcriber {
  async transcribe(audioPath: string): Promise<TranscriptionResult> {
    const apiKey = cfgString("SARVAM_API_KEY");
    if (!apiKey) {
      throw new Error("Sarvam diarization is not configured. Set SARVAM_API_KEY.");
    }

    if (!env.SARVAM_DIARIZATION_URL) {
      return this.transcribeWithSdk(audioPath);
    }

    const fileBuffer = await readFile(audioPath);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(fileBuffer)], { type: "audio/wav" }), "audio.wav");
    form.append("language_code", env.SARVAM_LANGUAGE_CODE);
    form.append("diarization", "true");
    form.append("timestamps", "true");

    const response = await fetch(env.SARVAM_DIARIZATION_URL, {
      method: "POST",
      headers: {
        "api-subscription-key": apiKey,
        "x-api-key": apiKey,
        Authorization: `Bearer ${apiKey}`
      },
      body: form
    });

    const body = await response.text();
    if (!response.ok) throw new Error(`Sarvam diarization failed with ${response.status}: ${body}`);

    const raw = body ? (JSON.parse(body) as SarvamResponse) : {};
    const segments = parseSarvamSegments(raw);

    return {
      provider: "sarvam",
      language: raw.language_code ?? raw.language,
      text: raw.text ?? raw.transcript ?? segments.map((segment) => segment.text).join(" "),
      segments,
      raw
    };
  }

  private async transcribeWithSdk(audioPath: string): Promise<TranscriptionResult> {
    const client = new SarvamAIClient({
      apiSubscriptionKey: cfgString("SARVAM_API_KEY") as string
    });
    const outputDir = path.join(path.dirname(audioPath), "sarvam-output");
    await mkdir(outputDir, { recursive: true });

    let lastError: unknown;
    for (let attempt = 1; attempt <= env.SARVAM_RETRY_ATTEMPTS; attempt += 1) {
      try {
        const initResponse = await client.speechToTextJob.initialise({
          job_parameters: {
            // Default saarika:v2.5 → native-language transcription. `mode` only
            // applies to saaras:v3 and saarika rejects it, so include it only
            // when explicitly configured.
            model: env.SARVAM_STT_MODEL,
            ...(env.SARVAM_STT_MODE ? { mode: env.SARVAM_STT_MODE } : {}),
            language_code: env.SARVAM_LANGUAGE_CODE as "unknown",
            with_diarization: true,
            with_timestamps: true
          } as Parameters<typeof client.speechToTextJob.initialise>[0]["job_parameters"]
        });

        const job = client.speechToTextJob.getJob(initResponse.job_id);
        await job.uploadFiles([audioPath]);
        await job.start();
        await job.waitUntilComplete();

        const fileResults = await job.getFileResults();
        if (fileResults.failed.length > 0) {
          const failures = fileResults.failed.map((file) => `${file.file_name}: ${file.error_message ?? file.status}`).join("; ");
          throw new Error(`Sarvam transcription failed: ${failures}`);
        }
        if (fileResults.successful.length === 0) {
          throw new Error("Sarvam transcription completed without successful files");
        }

        await job.downloadOutputs(outputDir);
        const transcriptPath = await resolveDownloadedTranscriptPath(outputDir, audioPath);
        const raw = JSON.parse(await readFile(transcriptPath, "utf8")) as SarvamJobResponse;
        const segments = parseSarvamJobSegments(raw);

        logger.info({ sarvamJobId: initResponse.job_id, transcriptPath, segmentCount: segments.length }, "Sarvam SDK transcription completed");

        return {
          provider: "sarvam",
          language: raw.language_code,
          text: raw.transcript ?? segments.map((segment) => segment.text).join(" "),
          segments,
          raw
        };
      } catch (error) {
        lastError = error;
        if (attempt >= env.SARVAM_RETRY_ATTEMPTS || !isRetryableSarvamError(error)) break;
        // Exponential backoff with full jitter. Without jitter, N concurrent
        // sessions that all 429 at the same time also retry at the same time
        // and 429 again together. Sleep is in [base, base * 2).
        const base = env.SARVAM_RETRY_DELAY_MS * 2 ** (attempt - 1);
        const delayMs = Math.floor(base + Math.random() * base);
        logger.warn({ attempt, retryInMs: delayMs, baseMs: base, err: error }, "Sarvam SDK transcription attempt failed; retrying");
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new Error(`Sarvam transcription failed: ${errorToText(lastError)}`);
  }
}

function parseSarvamSegments(raw: SarvamResponse): DiarizedTranscriptSegment[] {
  const source =
    raw.diarized_transcript ??
    raw.diarizedTranscript ??
    raw.diarized_transcript_entries ??
    raw.diarized_entries ??
    raw.diarized_transcript_result?.entries ??
    raw.segments ??
    [];
  return source
    .map((segment, index) => {
      const item = segment as SarvamSegment & SarvamJobEntry;
      const start = numberOr(item.start, item.start_time, item.start_time_seconds, item.startTime, 0);
      const end = numberOr(item.end, item.end_time, item.end_time_seconds, item.endTime, start + 0.01);
      const clusterId = resolveSarvamClusterId(item, index);
      const rawSpeaker = item.speaker ?? item.speakerLabel ?? item.speaker_id;
      const speaker = normalizeProviderSpeaker(rawSpeaker, clusterId);
      return {
        speaker,
        text: (item.text ?? item.transcript ?? "").trim(),
        startTime: normalizeSeconds(start),
        endTime: normalizeSeconds(end),
        confidence: typeof item.confidence === "number" ? item.confidence : undefined,
        clusterId
      };
    })
    .filter((segment) => segment.text && segment.endTime > segment.startTime);
}

function parseSarvamJobSegments(raw: SarvamJobResponse): DiarizedTranscriptSegment[] {
  const entries = raw.diarized_transcript?.entries ?? [];
  return entries
    .map((entry, index) => {
      const start = numberOr(entry.start_time_seconds, entry.start_time, 0);
      const end = numberOr(entry.end_time_seconds, entry.end_time, start + 0.01);
      const clusterId = resolveSarvamClusterId(entry, index);
      const rawSpeaker = entry.speaker ?? entry.speaker_id;

      return {
        speaker: normalizeProviderSpeaker(rawSpeaker, clusterId),
        text: (entry.transcript ?? entry.text ?? "").trim(),
        startTime: normalizeSeconds(start),
        endTime: normalizeSeconds(end),
        clusterId
      };
    })
    .filter((segment) => segment.text && segment.endTime > segment.startTime);
}

function resolveSarvamClusterId(item: { speaker_id?: string | number; speaker?: string }, index: number): string {
  if (item.speaker_id !== undefined && item.speaker_id !== null && String(item.speaker_id).trim() !== "") {
    return String(item.speaker_id).trim();
  }
  if (item.speaker && item.speaker.trim()) return item.speaker.trim();
  return `cluster-${index}`;
}

function numberOr(...values: unknown[]): number {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function normalizeSeconds(value: number): number {
  return value > 10000 ? value / 1000 : value;
}

async function resolveDownloadedTranscriptPath(outputDir: string, audioPath: string): Promise<string> {
  const expectedPath = path.join(outputDir, `${path.basename(audioPath)}.json`);
  try {
    await readFile(expectedPath, "utf8");
    return expectedPath;
  } catch {
    const files = await readdir(outputDir);
    const transcriptFile = files.find((file) => file.endsWith(".json"));
    if (!transcriptFile) throw new Error(`Sarvam transcript output was not downloaded to ${outputDir}`);
    return path.join(outputDir, transcriptFile);
  }
}

function normalizeProviderSpeaker(rawSpeaker: string | number | undefined | null, clusterId: string): string {
  const clean = typeof rawSpeaker === "number" ? String(rawSpeaker) : (rawSpeaker ?? "").trim();
  const isProviderPlaceholder = !clean || /^(none|null|undefined|unknown|n\/?a)$/i.test(clean) || /^speaker[\s_-]?(none|null|undefined|unknown)$/i.test(clean);

  if (isProviderPlaceholder || /^\d+$/.test(clean) || /^speaker(?:[\s_-]?\d+)?$/i.test(clean)) {
    const numericCluster = Number.parseInt(clusterId, 10);
    if (Number.isFinite(numericCluster) && numericCluster > 0) return `Speaker ${numericCluster}`;
    const numericRaw = Number.parseInt(clean, 10);
    if (Number.isFinite(numericRaw) && numericRaw > 0) return `Speaker ${numericRaw}`;
    return "Speaker 1";
  }
  return clean;
}

function isRetryableSarvamError(error: unknown): boolean {
  const message = errorToText(error).toLocaleLowerCase("en-US");
  return (
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("enotfound") ||
    message.includes("eai_again") ||
    message.includes("socket hang up") ||
    message.includes("429") ||
    /\b5\d\d\b/.test(message)
  );
}

function errorToText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}
