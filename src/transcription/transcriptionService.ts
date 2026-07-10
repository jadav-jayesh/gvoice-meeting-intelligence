import { env } from "../config/env";
import { cfgString } from "../config/runtimeConfig";
import { AzureOpenAIClient } from "../ai/azureOpenAI";
import { AzureOpenAITranscriber } from "./azureOpenAITranscriber";
import { SarvamTranscriber } from "./sarvamTranscriber";
import { WhisperProvider } from "./whisper/whisperProvider";
import { detectAudioLanguage } from "./audioLanguageProbe";
import { indicScriptFraction } from "./languageDetection";
import type { TranscriptionProvider, TranscriptionResult } from "./types";
import type { Logger } from "pino";

/**
 * Routes transcription to the configured provider and returns a provider-shaped
 * {@link TranscriptionResult} that downstream code consumes identically.
 *
 * Selection (env.TRANSCRIPTION_PROVIDER):
 *   - "language" → CURRENT PRODUCTION MODE. Detect the meeting language from the
 *                  AUDIO first (audioLanguageProbe), then route: English → Whisper
 *                  (no translation), non-English (Indic) → Sarvam (native). If
 *                  Whisper fails after its retries OR returns nothing, the English
 *                  meeting is handed to Sarvam too — so no meeting is ever lost.
 *   - "whisper" → the Azure Whisper + Pyannote pipeline, with the same
 *                 post-retry Sarvam handover. (Translation, if enabled, happens
 *                 downstream for non-English output.)
 *   - "sarvam"  → the Sarvam flow, ONLY. Native-language output is kept exactly
 *                 as-is and is never translated.
 *   - "auto"    → legacy behaviour (Azure/Sarvam auto-routing). UNCHANGED.
 *
 * The Whisper→Sarvam handover fires on ANY failure once Whisper has exhausted
 * its WHISPER_RETRY_ATTEMPTS internal retries (not just rate limits), gated on
 * WHISPER_SARVAM_FALLBACK plus a configured Sarvam key. A rerouted meeting is
 * native-untranslated (provider becomes "sarvam"). If Sarvam ALSO fails, the
 * failure propagates to the orchestrator, which degrades to a caption-derived
 * transcript and still completes the meeting — so the final safety net is intact.
 */
export class TranscriptionService {
  private readonly azure = new AzureOpenAITranscriber();
  private readonly sarvam = new SarvamTranscriber();
  private readonly azureClient = new AzureOpenAIClient();

  constructor(private readonly logger: Logger) {}

  async transcribe(audioPath: string): Promise<TranscriptionResult> {
    if (env.ALLOW_MOCK_AI) {
      this.logger.warn("ALLOW_MOCK_AI=true; returning empty mock transcription");
      return { provider: "mock", text: "", segments: [] };
    }

    switch (cfgString("TRANSCRIPTION_PROVIDER")) {
      case "language":
        return this.transcribeByDetectedLanguage(audioPath);
      case "whisper":
        return this.transcribeWithWhisper(audioPath);
      case "sarvam":
        return this.sarvam.transcribe(audioPath);
      default:
        return this.legacyTranscribe(audioPath);
    }
  }

  // Language-routed transcription. Detect English vs non-English from the audio
  // FIRST, then send English meetings to Whisper and non-English (Indic) ones
  // straight to Sarvam — so Whisper is never asked to decode Gujarati, which it
  // can't, and non-English transcripts stay clean native text (no translation).
  // A non-English meeting only routes to Sarvam when the flag is on and Sarvam
  // is configured; otherwise it falls back to Whisper (best effort + handover).
  private async transcribeByDetectedLanguage(audioPath: string): Promise<TranscriptionResult> {
    const detection = await detectAudioLanguage(audioPath, this.logger);
    const routeToSarvam = !detection.isEnglish && env.WHISPER_NONENGLISH_TO_SARVAM && Boolean(cfgString("SARVAM_API_KEY"));

    this.logger.info(
      { detectedLanguage: detection.language, isEnglish: detection.isEnglish, source: detection.source, routeToSarvam },
      "language routing decision"
    );

    if (routeToSarvam) return this.sarvam.transcribe(audioPath);
    // English (or non-English with Sarvam unavailable) → Whisper, with the
    // post-retry Sarvam handover as the safety net.
    return this.transcribeWithWhisper(audioPath);
  }

  // Whisper, with the always-succeed Sarvam handover. Whisper retries each
  // Azure call WHISPER_RETRY_ATTEMPTS (3) times internally; once those are
  // exhausted the error reaches here. Per the "never fail a meeting" policy the
  // handover now fires on ANY failure (not just rate limits) AND on an empty
  // Whisper result — so an English meeting Whisper cannot decode is recovered by
  // Sarvam instead of being lost. Gated on WHISPER_SARVAM_FALLBACK + a Sarvam
  // key; if those are off the error/empty result propagates unchanged. If Sarvam
  // also fails, its error propagates to the orchestrator's caption fallback.
  private async transcribeWithWhisper(audioPath: string): Promise<TranscriptionResult> {
    const sarvamAvailable = env.WHISPER_SARVAM_FALLBACK && Boolean(cfgString("SARVAM_API_KEY"));
    try {
      const result = await new WhisperProvider(this.logger).transcribe(audioPath);
      if (isTranscriptionResultEmpty(result) && sarvamAvailable) {
        this.logger.warn("Whisper returned no usable speech after retries; rerouting this meeting to Sarvam");
        return this.sarvam.transcribe(audioPath);
      }
      return result;
    } catch (error) {
      if (sarvamAvailable) {
        this.logger.warn({ err: error }, "Whisper failed after retries; rerouting this meeting to Sarvam");
        return this.sarvam.transcribe(audioPath);
      }
      throw error;
    }
  }

  // ── Legacy "auto" path (pre-existing behaviour, intentionally unchanged) ────

  private async legacyTranscribe(audioPath: string): Promise<TranscriptionResult> {
    if (env.TRANSCRIPTION_FORCE_PROVIDER === "sarvam") return this.sarvam.transcribe(audioPath);
    if (env.TRANSCRIPTION_FORCE_PROVIDER === "azure") return this.azure.transcribe(audioPath);

    if (!this.azureClient.isTranscriptionConfigured()) {
      this.logger.info("Azure transcription endpoint not configured; routing transcription to Sarvam");
      return this.sarvam.transcribe(audioPath);
    }

    let azureResult: TranscriptionResult;
    try {
      azureResult = await this.azure.transcribe(audioPath);
    } catch (error) {
      if (cfgString("SARVAM_API_KEY") && isRetryableAzureTranscriptionError(error)) {
        this.logger.warn({ err: error }, "Azure transcription failed transiently; routing transcription to Sarvam");
        return this.sarvam.transcribe(audioPath);
      }
      throw error;
    }
    const language = (azureResult.language ?? "").toLocaleLowerCase("en-US");
    const codemixDetected = containsIndicScript(azureResult.text);

    this.logger.info({ provider: "azure", language, codemixDetected, segments: azureResult.segments.length }, "language detection result");

    if ((language && !language.includes("en")) || codemixDetected) {
      if (env.SARVAM_DIARIZATION_URL && cfgString("SARVAM_API_KEY")) {
        this.logger.info("routing multilingual/codemix audio to Sarvam diarization");
        return this.sarvam.transcribe(audioPath);
      }
      this.logger.warn("multilingual/codemix detected but Sarvam is not configured; using Azure result");
    }

    return azureResult;
  }
}

/**
 * True when this transcript should be translated to English downstream.
 *
 * Translation applies ONLY to actual WHISPER output — never to Sarvam, which
 * already returns clean native-language text the team wants to keep as-is. The
 * gate keys on the *result provider*, so a Sarvam-mode meeting (or any Sarvam
 * result) is never translated, regardless of env. `enabled` is injectable for
 * unit testing.
 */
export function shouldTranslateToEnglish(result: TranscriptionResult, enabled: boolean = env.TRANSLATION_ENABLED): boolean {
  if (!enabled) return false;
  if (result.provider !== "whisper") return false;
  const language = (result.language ?? "").toLocaleLowerCase("en-US");
  if (language && language !== "en" && !language.startsWith("en")) return true;
  // Language metadata can be wrong/missing — also translate when Indic script is
  // present in the (Whisper) transcript text.
  return indicScriptFraction(result.text) > 0;
}

function containsIndicScript(text: string): boolean {
  return /[ऀ-ॿ઀-૿]/u.test(text);
}

/** A transcription carries no usable speech (triggers the Sarvam handover). */
function isTranscriptionResultEmpty(result: TranscriptionResult): boolean {
  return result.text.trim().length === 0 && result.segments.length === 0;
}

function isRetryableAzureTranscriptionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLocaleLowerCase("en-US") : String(error).toLocaleLowerCase("en-US");
  return (
    message.includes("429") ||
    message.includes("too many request") ||
    message.includes("rate limit") ||
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    /\b5\d\d\b/.test(message)
  );
}

// Re-export for callers that branch on provider identity.
export type { TranscriptionProvider };
