import { describe, expect, it, vi } from "vitest";
import { TranslationService, isMetaPlaceholder } from "../src/ai/translationService";
import type { AzureOpenAIClient } from "../src/ai/azureOpenAI";
import type { DiarizedTranscriptSegment } from "../src/types/meeting";
import { logger } from "../src/utils/logger";

function segment(text: string, start: number): DiarizedTranscriptSegment {
  return { speaker: "SPEAKER_00", clusterId: "SPEAKER_00", text, startTime: start, endTime: start + 1 };
}

function fakeClient(overrides: Partial<AzureOpenAIClient>): AzureOpenAIClient {
  return {
    isChatConfigured: () => true,
    chatJson: vi.fn(),
    ...overrides
  } as unknown as AzureOpenAIClient;
}

describe("TranslationService.translateSegments", () => {
  it("replaces text with English and preserves the native source in originalText", async () => {
    const client = fakeClient({
      chatJson: vi.fn().mockResolvedValue({
        translations: [
          { id: 0, text: "How are you?" },
          { id: 1, text: "Hello" }
        ]
      })
    });
    const service = new TranslationService(logger, client);

    const result = await service.translateSegments([segment("Kem cho?", 0), segment("Hello", 1)], { sourceLanguage: "gu", enabled: true });

    expect(result[0].text).toBe("How are you?");
    expect(result[0].originalText).toBe("Kem cho?");
    // Already-English line returned unchanged → no originalText recorded.
    expect(result[1].text).toBe("Hello");
    expect(result[1].originalText).toBeUndefined();
  });

  it("keeps the original-language transcript when a batch fails", async () => {
    const client = fakeClient({ chatJson: vi.fn().mockRejectedValue(new Error("azure 500")) });
    const service = new TranslationService(logger, client);

    const result = await service.translateSegments([segment("Kem cho?", 0)], { enabled: true });

    expect(result[0].text).toBe("Kem cho?");
    expect(result[0].originalText).toBeUndefined();
  });

  it("rejects meta-placeholder 'translations' and keeps the original spoken text", async () => {
    const client = fakeClient({
      chatJson: vi.fn().mockResolvedValue({
        translations: [
          { id: 0, text: "Yesterday's deployment was successful." },
          { id: 1, text: "[Unintelligible or repetitive filler speech — unable to derive meaningful translation]" }
        ]
      })
    });
    const service = new TranslationService(logger, client);

    const result = await service.translateSegments([segment("Kal ka deployment successful raha.", 0), segment("aa aa aa aa", 1)], {
      sourceLanguage: "hi",
      enabled: true
    });

    expect(result[0].text).toBe("Yesterday's deployment was successful.");
    // The placeholder is discarded — original text is preserved, no bracket note.
    expect(result[1].text).toBe("aa aa aa aa");
    expect(result[1].text).not.toContain("[");
    expect(result[1].originalText).toBeUndefined();
  });

  it("is a no-op when chat is not configured", async () => {
    const chatJson = vi.fn();
    const client = fakeClient({ isChatConfigured: () => false, chatJson });
    const service = new TranslationService(logger, client);

    const input = [segment("Kem cho?", 0)];
    const result = await service.translateSegments(input, { enabled: true });

    expect(chatJson).not.toHaveBeenCalled();
    expect(result[0].text).toBe("Kem cho?");
  });
});

describe("isMetaPlaceholder", () => {
  it("flags bracketed notes and inability phrases", () => {
    expect(isMetaPlaceholder("[Unintelligible or repetitive filler speech — unable to derive meaningful translation]")).toBe(true);
    expect(isMetaPlaceholder("(inaudible)")).toBe(true);
    expect(isMetaPlaceholder("Unintelligible filler speech")).toBe(true);
    expect(isMetaPlaceholder("")).toBe(true);
  });

  it("does not flag genuine translations", () => {
    expect(isMetaPlaceholder("Yesterday's deployment was successful.")).toBe(false);
    expect(isMetaPlaceholder("There was an issue in the backend, but it is resolved.")).toBe(false);
    // A real sentence that merely mentions 'speech' is not a placeholder.
    expect(isMetaPlaceholder("We reviewed the text-to-speech feature and it works well across the new modules.")).toBe(false);
  });
});
