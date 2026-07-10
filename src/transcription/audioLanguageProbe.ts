import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { env } from "../config/env";
import { extractAudioSegment, probeDurationSeconds } from "../media/ffmpeg";
import { detectMeetingLanguage } from "./languageDetection";
import { AzureWhisperTranscriber } from "./whisper/azureWhisperTranscriber";
import type { Logger } from "pino";

/**
 * Audio-based language pre-detection.
 *
 * The provider for a meeting is chosen BEFORE transcription: English meetings go
 * to Whisper, non-English (Indic) meetings go to Sarvam. We must therefore know
 * the language without having transcribed the whole meeting yet, and we must get
 * it from the AUDIO — this team's romanized/absent live captions are unreliable
 * for Indic, so caption-based detection is not an option.
 *
 * Strategy: decode one short, speech-dense sample with Whisper and classify by
 * SCRIPT CONTENT (Devanagari/Gujarati vs Latin) via {@link detectMeetingLanguage}
 * — not Whisper's own language label, which mislabels Gujarati. A sample is
 * enough to tell English from Indic.
 *
 * This intentionally never throws and never blocks a meeting: on any error,
 * empty audio, or unconfigured Whisper it defaults to ENGLISH. A wrong English
 * guess is self-healing — the full Whisper run will come back empty/garbage and
 * the Whisper→Sarvam handover in TranscriptionService recovers the meeting.
 */
export interface AudioLanguageDetection {
  // True → route to Whisper (English). False → route to Sarvam (Indic).
  isEnglish: boolean;
  // Detected language code (en | hi | gu | mixed | <whisper code>). Routing
  // hint/telemetry only; the final meetingLanguage is re-derived downstream from
  // the full transcript.
  language: string;
  // Fraction (0..1) of probe letters that were Indic script.
  indicFraction: number;
  // "probe" when a sample was actually decoded; "default" when we fell back to
  // the English default (probe unavailable/failed/empty).
  source: "probe" | "default";
}

const ENGLISH_DEFAULT: AudioLanguageDetection = { isEnglish: true, language: "en", indicFraction: 0, source: "default" };

export async function detectAudioLanguage(audioPath: string, logger: Logger): Promise<AudioLanguageDetection> {
  const whisper = new AzureWhisperTranscriber(logger);
  if (!whisper.isConfigured()) {
    logger.warn("language probe: Whisper not configured; defaulting to English routing");
    return ENGLISH_DEFAULT;
  }

  try {
    const text = await decodeSample(audioPath, whisper, logger);
    if (!text.trim()) {
      logger.info("language probe: empty sample transcript; defaulting to English routing");
      return ENGLISH_DEFAULT;
    }

    const detection = detectMeetingLanguage(text);
    const isEnglish = detection.indicFraction < env.WHISPER_NONENGLISH_INDIC_THRESHOLD;
    logger.info(
      {
        probeLanguage: detection.meetingLanguage,
        indicFraction: Number(detection.indicFraction.toFixed(2)),
        threshold: env.WHISPER_NONENGLISH_INDIC_THRESHOLD,
        isEnglish
      },
      "language probe complete"
    );
    return {
      isEnglish,
      language: detection.meetingLanguage,
      indicFraction: detection.indicFraction,
      source: "probe"
    };
  } catch (error) {
    // Probe is best-effort. A failure here (often an Azure 429 on the S0 tier)
    // must not fail the meeting — default to English and let the downstream
    // Whisper→Sarvam handover recover a wrong guess.
    logger.warn({ err: error }, "language probe failed; defaulting to English routing");
    return ENGLISH_DEFAULT;
  }
}

/**
 * Decode a short speech-dense window of the audio. For clips at/under the probe
 * length the whole file is decoded; otherwise a single window starting a little
 * way in (past any opening silence/greetings) is sliced out and decoded.
 */
async function decodeSample(audioPath: string, whisper: AzureWhisperTranscriber, logger: Logger): Promise<string> {
  const probeSeconds = env.WHISPER_LANGUAGE_PROBE_SECONDS;
  const duration = await probeDurationSeconds(audioPath).catch(() => 0);

  if (duration <= 0 || duration <= probeSeconds * 1.5) {
    const whole = await whisper.transcribeFile(audioPath);
    return whole.text;
  }

  const start = Math.min(duration * 0.1, 30);
  const end = Math.min(duration, start + probeSeconds);
  const workDir = await mkdtemp(path.join(tmpdir(), "lang-probe-"));
  const slicePath = path.join(workDir, "sample.wav");
  try {
    const ok = await extractAudioSegment(audioPath, start, end, slicePath);
    if (!ok) {
      logger.info("language probe: sample extraction failed; decoding whole file");
      const whole = await whisper.transcribeFile(audioPath);
      return whole.text;
    }
    const sample = await whisper.transcribeFile(slicePath);
    return sample.text;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
