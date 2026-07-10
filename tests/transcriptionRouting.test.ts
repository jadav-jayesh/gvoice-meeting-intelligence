import { describe, expect, it } from "vitest";
import { shouldTranslateToEnglish } from "../src/transcription/transcriptionService";
import type { TranscriptionProvider, TranscriptionResult } from "../src/transcription/types";

function result(provider: TranscriptionProvider, partial: Partial<TranscriptionResult> = {}): TranscriptionResult {
  return { provider, text: "", segments: [], ...partial };
}

describe("shouldTranslateToEnglish", () => {
  it("NEVER translates Sarvam output — Sarvam stays native, untouched", () => {
    expect(shouldTranslateToEnglish(result("sarvam", { language: "gu-IN", text: "કેમ છો" }), true)).toBe(false);
    expect(shouldTranslateToEnglish(result("sarvam", { language: "hi", text: "कैसे हो" }), true)).toBe(false);
    expect(shouldTranslateToEnglish(result("azure", { language: "gu", text: "કેમ છો" }), true)).toBe(false);
  });

  it("translates non-English WHISPER output to English", () => {
    expect(shouldTranslateToEnglish(result("whisper", { language: "gu", text: "કેમ છો" }), true)).toBe(true);
    expect(shouldTranslateToEnglish(result("whisper", { language: "hi", text: "कैसे हो" }), true)).toBe(true);
    expect(shouldTranslateToEnglish(result("whisper", { language: "mixed", text: "આજે deployment" }), true)).toBe(true);
  });

  it("translates ALL non-English Whisper languages, not just Indic ones", () => {
    // Whisper sometimes labels garbled Indic audio "pa"; and genuinely foreign
    // meetings (fr/es/de...) must also end up English in transcriptText.
    expect(shouldTranslateToEnglish(result("whisper", { language: "pa", text: "..." }), true)).toBe(true);
    expect(shouldTranslateToEnglish(result("whisper", { language: "fr", text: "Bonjour à tous" }), true)).toBe(true);
    expect(shouldTranslateToEnglish(result("whisper", { language: "es", text: "Hola a todos" }), true)).toBe(true);
    expect(shouldTranslateToEnglish(result("whisper", { language: "de", text: "Guten Morgen" }), true)).toBe(true);
  });

  it("does not translate a clean English Whisper meeting", () => {
    expect(shouldTranslateToEnglish(result("whisper", { language: "en", text: "hello everyone" }), true)).toBe(false);
  });

  it("translates Whisper output when the language label is wrong but Indic script is present", () => {
    expect(shouldTranslateToEnglish(result("whisper", { language: "en", text: "ok કેમ છો" }), true)).toBe(true);
  });

  it("never translates when translation is disabled", () => {
    expect(shouldTranslateToEnglish(result("whisper", { language: "gu", text: "કેમ છો" }), false)).toBe(false);
  });
});
