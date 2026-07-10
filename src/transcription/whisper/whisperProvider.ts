import { env } from "../../config/env";
import { logger as rootLogger } from "../../utils/logger";
import type { DiarizedTranscriptSegment } from "../../types/meeting";
import { detectMeetingLanguage } from "../languageDetection";
import { mergeTranscriptWithDiarization } from "../merge/transcriptDiarizationMerger";
import { PyannoteDiarizationProvider } from "../pyannote/pyannoteDiarizationProvider";
import type { DiarizationSpan, Transcriber, TranscriptionResult, WhisperResult } from "../types";
import { AzureWhisperTranscriber, isWhisperResultEmpty, mergeWhisperResults } from "./azureWhisperTranscriber";
import type { Logger } from "pino";

// Two adjacent same-speaker pyannote spans separated by less than this gap are
// merged into one decode region, so we don't fire a Whisper call per breath.
const REGION_MERGE_GAP_SECONDS = 0.8;
// Don't bother slicing a region shorter than this — fold it into its neighbour.
const MIN_REGION_SECONDS = 0.4;
// Safety valve: if diarization produced an absurd number of regions, decode the
// whole file instead of hammering the Whisper endpoint with hundreds of calls.
const MAX_REGIONS = 400;

export interface SpeakerRegion {
  speaker: string;
  start: number;
  end: number;
}

/**
 * The Azure Whisper + Pyannote transcription provider. Implements the same
 * {@link Transcriber} contract as the Sarvam flow and returns an identical
 * {@link TranscriptionResult}, so everything downstream (normalize → speaker
 * mapping → resolver → transcriptText) is provider-agnostic.
 *
 * Pipeline: pyannote diarization → per-speaker-region Whisper decode (each
 * region auto-detects its own language so a code-mixed meeting keeps every
 * speaker's language) → overlap-based merge → script-based language detection.
 *
 * Translation to English happens later, in the orchestrator, gated on this
 * provider — so speaker mapping still runs against the NATIVE transcript.
 */
export class WhisperProvider implements Transcriber {
  private readonly log: Logger;
  private readonly whisper: AzureWhisperTranscriber;
  private readonly diarizer: PyannoteDiarizationProvider;

  constructor(logger: Logger = rootLogger) {
    this.log = logger;
    this.whisper = new AzureWhisperTranscriber(logger);
    this.diarizer = new PyannoteDiarizationProvider(logger);
  }

  isConfigured(): boolean {
    return this.whisper.isConfigured();
  }

  async transcribe(audioPath: string): Promise<TranscriptionResult> {
    this.whisper.assertConfigured();

    // 1. Diarize first (best-effort — empty spans degrade to single speaker).
    let spans: DiarizationSpan[] = [];
    try {
      const diarization = await this.diarizer.diarize(audioPath);
      spans = diarization.spans;
    } catch (error) {
      this.log.warn({ err: error }, "pyannote diarization failed; transcribing without speaker spans");
    }

    // 2. Transcribe — per-speaker-region by default, whole-file otherwise.
    // Per-region decoding only earns its extra Azure calls when there is more
    // than one speaker to keep in separate languages. With a single diarized
    // speaker a whole-file decode is one call instead of N — materially fewer
    // S0-tier 429s — and yields the same result.
    const distinctSpeakers = new Set(spans.map((span) => span.speaker)).size;
    const usePerRegion = env.WHISPER_PER_REGION_DECODE && distinctSpeakers >= 2;
    let whisper: WhisperResult;
    let mergeSpans: DiarizationSpan[];

    if (usePerRegion) {
      const regions = buildSpeakerRegions(spans);
      if (regions.length > 0 && regions.length <= MAX_REGIONS) {
        whisper = await this.transcribeRegions(audioPath, regions);
        // Merge against the regions themselves: each region's words are known to
        // belong to that region's speaker, so attribution is exact.
        mergeSpans = regions.map((region) => ({ speaker: region.speaker, start: region.start, end: region.end }));
      } else {
        this.log.info({ regionCount: regions.length }, "region count outside bounds; using whole-file decode");
        whisper = await this.whisper.transcribeFile(audioPath);
        mergeSpans = spans;
      }
    } else {
      whisper = await this.whisper.transcribeFile(audioPath);
      mergeSpans = spans;

      // Sparse-audio rescue: a whole-file decode of short/quiet clips sometimes
      // comes back empty even though diarization found speech. Re-decode per
      // region to recover it.
      if (isWhisperResultEmpty(whisper) && spans.length > 0) {
        this.log.info("whole-file whisper returned empty; attempting per-region rescue");
        const regions = buildSpeakerRegions(spans).slice(0, MAX_REGIONS);
        if (regions.length > 0) {
          whisper = await this.transcribeRegions(audioPath, regions);
          mergeSpans = regions.map((region) => ({ speaker: region.speaker, start: region.start, end: region.end }));
        }
      }
    }

    // 3. Merge transcript + diarization into speaker segments.
    const segments: DiarizedTranscriptSegment[] = mergeTranscriptWithDiarization(whisper, mergeSpans);
    const text = whisper.text || segments.map((segment) => segment.text).join(" ");

    // 4. Detect meeting language from the actual script content.
    const detection = detectMeetingLanguage(text, whisper.language);
    for (const segment of segments) segment.language = detectMeetingLanguage(segment.text, whisper.language).primaryLanguage;

    this.log.info(
      {
        provider: "whisper",
        spanCount: spans.length,
        perRegion: usePerRegion,
        segmentCount: segments.length,
        meetingLanguage: detection.meetingLanguage,
        indicFraction: Number(detection.indicFraction.toFixed(2))
      },
      "whisper pipeline complete"
    );

    return {
      provider: "whisper",
      language: detection.meetingLanguage,
      text,
      segments,
      raw: { whisper: whisper.raw, spans, detection }
    };
  }

  private async transcribeRegions(audioPath: string, regions: SpeakerRegion[]): Promise<WhisperResult> {
    const concurrency = Math.max(1, env.WHISPER_REGION_CONCURRENCY);
    const results: WhisperResult[] = new Array(regions.length);

    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, regions.length) }, async () => {
      while (cursor < regions.length) {
        const index = cursor;
        cursor += 1;
        const region = regions[index];
        try {
          // No prompt, no forced language — let each region auto-detect so every
          // speaker keeps their own language (a poisoned/forced prompt makes
          // Whisper echo gibberish — see whisper-rebuild memory).
          results[index] = await this.whisper.transcribeRegion(audioPath, region.start, region.end);
        } catch (error) {
          this.log.warn({ err: error, region }, "region transcription failed; skipping region");
          results[index] = { text: "", words: [], segments: [], offsetSeconds: region.start };
        }
      }
    });

    await Promise.all(workers);
    return mergeWhisperResults(results.filter(Boolean));
  }
}

/**
 * Collapse fine-grained pyannote spans into contiguous same-speaker decode
 * regions: merge adjacent spans by the same speaker across small gaps, then
 * fold away regions too short to transcribe on their own.
 */
export function buildSpeakerRegions(spans: DiarizationSpan[]): SpeakerRegion[] {
  const ordered = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: SpeakerRegion[] = [];

  for (const span of ordered) {
    const previous = merged[merged.length - 1];
    if (previous && previous.speaker === span.speaker && span.start - previous.end <= REGION_MERGE_GAP_SECONDS) {
      previous.end = Math.max(previous.end, span.end);
      continue;
    }
    merged.push({ speaker: span.speaker, start: span.start, end: span.end });
  }

  // Fold sub-minimum regions into the previous region to avoid tiny slices.
  const result: SpeakerRegion[] = [];
  for (const region of merged) {
    if (region.end - region.start >= MIN_REGION_SECONDS || result.length === 0) {
      result.push(region);
    } else {
      result[result.length - 1].end = region.end;
    }
  }
  return result;
}
