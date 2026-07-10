import { describe, expect, it } from "vitest";
import { isWhisperResultEmpty, mergeWhisperResults, parseVerboseJson } from "../src/transcription/whisper/azureWhisperTranscriber";
import { buildSpeakerRegions } from "../src/transcription/whisper/whisperProvider";

describe("parseVerboseJson", () => {
  it("parses words + segments and applies the region offset to timestamps", () => {
    const result = parseVerboseJson(
      {
        text: "kem cho",
        language: "gujarati",
        words: [
          { word: "kem", start: 0.2, end: 0.5 },
          { word: "cho", start: 0.6, end: 0.9 }
        ],
        segments: [{ id: 0, text: "kem cho", start: 0.2, end: 0.9, no_speech_prob: 0.1 }]
      },
      10
    );

    expect(result.language).toBe("gu"); // full name normalised to code
    expect(result.words[0].start).toBeCloseTo(10.2, 5);
    expect(result.words[1].end).toBeCloseTo(10.9, 5);
    expect(result.segments[0].start).toBeCloseTo(10.2, 5);
    expect(result.offsetSeconds).toBe(10);
  });

  it("detects an empty result", () => {
    expect(isWhisperResultEmpty(parseVerboseJson({ text: "", words: [], segments: [] }))).toBe(true);
    expect(isWhisperResultEmpty(parseVerboseJson({ text: "hi", words: [], segments: [] }))).toBe(false);
  });
});

describe("mergeWhisperResults", () => {
  it("concatenates text and sorts words across regions", () => {
    const merged = mergeWhisperResults([
      parseVerboseJson({ text: "world", words: [{ word: "world", start: 5, end: 5.4 }], segments: [] }),
      parseVerboseJson({ text: "hello", words: [{ word: "hello", start: 0, end: 0.4 }], segments: [] })
    ]);
    expect(merged.words.map((w) => w.word)).toEqual(["hello", "world"]);
    expect(merged.text).toContain("hello");
    expect(merged.text).toContain("world");
  });
});

describe("buildSpeakerRegions", () => {
  it("merges adjacent same-speaker spans across a small gap and breaks on speaker change", () => {
    const regions = buildSpeakerRegions([
      { speaker: "SPEAKER_00", start: 0, end: 2 },
      { speaker: "SPEAKER_00", start: 2.5, end: 4 }, // gap 0.5 < 0.8 → merge
      { speaker: "SPEAKER_01", start: 4.1, end: 6 }
    ]);
    expect(regions).toHaveLength(2);
    expect(regions[0]).toMatchObject({ speaker: "SPEAKER_00", start: 0, end: 4 });
    expect(regions[1].speaker).toBe("SPEAKER_01");
  });
});
