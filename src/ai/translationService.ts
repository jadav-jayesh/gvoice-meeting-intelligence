import { env } from "../config/env";
import type { DiarizedTranscriptSegment } from "../types/meeting";
import { logger as rootLogger } from "../utils/logger";
import { AzureOpenAIClient } from "./azureOpenAI";
import type { Logger } from "pino";

// Technical terms that must survive translation verbatim (STEP 6, rule 13).
const PROTECTED_TERMS = [
  "API",
  "Backend",
  "Frontend",
  "Database",
  "Node.js",
  "TypeScript",
  "Socket.IO",
  "Azure",
  "Zoom",
  "Teams",
  "Google Meet",
  "Redis",
  "MongoDB",
  "PostgreSQL",
  "Docker",
  "Kubernetes",
  "Webhook",
  "Microservice",
  "JWT"
];

// STEP 6 — Gujarati / Hindi → professional English knowledge prompt. Encodes the
// preservation rules (names, companies, technical terms, ordering, no invention)
// and a few worked examples so the model favours meaning over literal wording.
const SYSTEM_PROMPT = [
  "You are a professional meeting-transcript translator for an engineering team.",
  "You translate Gujarati, Hindi, and Gujarati/Hindi+English code-mixed speech into natural, professional English.",
  "",
  "Rules:",
  "1. Translate each line as a whole paragraph — never word-by-word.",
  "2. Preserve the meaning, business context and technical detail exactly. Do not summarize, shorten, or omit anything.",
  "3. Keep person names and company names EXACTLY as written (do not translate or transliterate them).",
  "4. Keep these technical terms unchanged: " + PROTECTED_TERMS.join(", ") + ".",
  "5. If a line is already in English, return it unchanged.",
  "6. Never invent content or add information that is not in the line.",
  "7. Output professional English that reads naturally; prioritise semantic meaning over literal translation.",
  "8. CRITICAL: Output ONLY the translated spoken words. If a line is gibberish, repeated filler, or you cannot translate it, return the ORIGINAL line text UNCHANGED. NEVER output notes, descriptions, or placeholders about the audio — e.g. do NOT output things like \"[Unintelligible]\", \"[inaudible]\", \"[repetitive filler speech]\", \"[unable to translate]\", or any bracketed commentary. Such meta-notes are forbidden.",
  "",
  "Examples:",
  '"Kem cho badha?" -> "How is everyone doing?"',
  '"Aaje deployment complete thai gayu." -> "Today\'s deployment has been completed."',
  '"Backend ma issue hato but have solve thai gayo." -> "There was an issue in the backend, but it has now been resolved."',
  '"API response slow hati." -> "The API response was slow."',
  '"Kal ka deployment successful raha." -> "Yesterday\'s deployment was successful."',
  "",
  'Return ONLY JSON of the form {"translations":[{"id":<number>,"text":"<english>"}]} with one entry per input line, same ids.'
].join("\n");

interface TranslationLine {
  id: number;
  text: string;
}

interface TranslationResponse {
  translations?: Array<{ id?: number; text?: string }>;
}

export interface TranslateOptions {
  sourceLanguage?: string;
  // Override the global env.TRANSLATION_ENABLED gate (injectable for tests, and
  // for callers that have already decided translation should run).
  enabled?: boolean;
}

/**
 * Translates speaker SEGMENTS (paragraphs) to English for non-English meetings.
 *
 * Returns new segments whose `text` is English and whose `originalText` holds
 * the text exactly as spoken (only when it actually changed). Translation is
 * best-effort: any batch that fails to translate keeps its original text, so a
 * transcript is always produced — it just stays in the source language.
 */
export class TranslationService {
  private readonly log: Logger;
  private readonly client: AzureOpenAIClient;

  constructor(logger: Logger = rootLogger, client: AzureOpenAIClient = new AzureOpenAIClient()) {
    this.log = logger;
    this.client = client;
  }

  isConfigured(): boolean {
    return this.client.isChatConfigured();
  }

  async translateSegments(
    segments: DiarizedTranscriptSegment[],
    options: TranslateOptions = {}
  ): Promise<DiarizedTranscriptSegment[]> {
    const enabled = options.enabled ?? env.TRANSLATION_ENABLED;
    if (!enabled || segments.length === 0) return segments;
    if (!this.isConfigured()) {
      this.log.warn("translation requested but Azure chat is not configured; keeping original-language transcript");
      return segments;
    }

    const result = segments.map((segment) => ({ ...segment }));
    const batches = chunk(result, env.TRANSLATION_BATCH_SIZE);

    // Translate batches concurrently rather than one-after-another. Every batch
    // except the last is exactly TRANSLATION_BATCH_SIZE, so a batch's offset
    // into `result` is simply its index × batch size — each worker writes only
    // its own slice, so order and the per-batch best-effort fallback are
    // preserved while the GPT round-trips overlap.
    const concurrency = Math.max(1, Math.min(env.TRANSLATION_CONCURRENCY, batches.length));
    let nextBatch = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (nextBatch < batches.length) {
        const batchIndex = nextBatch;
        nextBatch += 1;
        const batch = batches[batchIndex];
        const offset = batchIndex * env.TRANSLATION_BATCH_SIZE;
        const lines: TranslationLine[] = batch.map((segment, index) => ({ id: index, text: segment.text }));

        try {
          const translations = await this.translateBatch(lines, options.sourceLanguage);
          for (const line of translations) {
            if (line.id === undefined || !line.text) continue;
            const target = result[offset + line.id];
            if (!target) continue;
            const english = line.text.trim();
            // Guard against the model editorialising on garbled audio. If it
            // returns a meta-note/placeholder instead of an actual translation,
            // discard it and keep the original spoken text — never let
            // "[Unintelligible …]"-style commentary into the transcript.
            if (isMetaPlaceholder(english)) {
              this.log.debug({ rejected: english, original: target.text }, "rejected meta-placeholder translation; keeping original text");
              continue;
            }
            if (english && english !== target.text) {
              target.originalText = target.text;
              target.text = english;
            }
          }
        } catch (error) {
          this.log.warn({ err: error, batchStart: offset, batchSize: batch.length }, "segment translation batch failed; keeping original text");
        }
      }
    });
    await Promise.all(workers);

    const translatedCount = result.filter((segment) => segment.originalText !== undefined).length;
    this.log.info({ segmentCount: result.length, translatedCount, sourceLanguage: options.sourceLanguage }, "segment translation complete");
    return result;
  }

  private async translateBatch(lines: TranslationLine[], sourceLanguage?: string): Promise<Array<{ id?: number; text?: string }>> {
    const userPayload = {
      sourceLanguage: sourceLanguage ?? "auto",
      lines
    };
    const response = await this.client.chatJson<TranslationResponse>(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(userPayload) }
      ],
      "segment translation",
      { maxCompletionTokens: env.TRANSLATION_MAX_TOKENS }
    );
    return response.translations ?? [];
  }
}

// Detects AI "meta-commentary" the translator sometimes emits for garbled audio
// instead of a real translation, so we can reject it and keep the spoken text.
// Matches a whole line wrapped in [] or (), or a short line dominated by an
// untranslatable/inaudible note.
export function isMetaPlaceholder(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/^[[(][^\])]*[\])]$/.test(trimmed)) return true;
  return (
    trimmed.length <= 160 &&
    /\b(unintelligible|inaudible|untranslatable|indiscernible|repetitive filler|filler (?:speech|sounds|noise)|unable to (?:translate|derive)|cannot be translated|no (?:meaningful|discernible|clear) (?:speech|translation|content|words))\b/i.test(trimmed)
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
