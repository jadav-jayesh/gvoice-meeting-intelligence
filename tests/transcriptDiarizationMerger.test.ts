import { describe, expect, it } from "vitest";
import { mergeTranscriptWithDiarization } from "../src/transcription/merge/transcriptDiarizationMerger";
import type { DiarizationSpan, WhisperResult } from "../src/transcription/types";

function whisper(words: Array<{ word: string; start: number; end: number }>): WhisperResult {
  return { text: words.map((w) => w.word).join(" "), language: "en", words, segments: [], offsetSeconds: 0 };
}

const spans: DiarizationSpan[] = [
  { speaker: "SPEAKER_00", start: 0, end: 5 },
  { speaker: "SPEAKER_01", start: 5, end: 10 }
];

describe("mergeTranscriptWithDiarization", () => {
  it("assigns words to the containing speaker span and groups by speaker", () => {
    const result = mergeTranscriptWithDiarization(
      whisper([
        { word: "hello", start: 2.1, end: 2.5 },
        { word: "everyone", start: 2.6, end: 3.0 },
        { word: "thanks", start: 6.0, end: 6.4 },
        { word: "all", start: 6.5, end: 6.9 }
      ]),
      spans
    );

    expect(result).toHaveLength(2);
    expect(result[0].clusterId).toBe("SPEAKER_00");
    expect(result[0].text).toBe("hello everyone");
    expect(result[1].clusterId).toBe("SPEAKER_01");
    expect(result[1].text).toBe("thanks all");
  });

  it("uses overlap (not nearest start) for words straddling a boundary", () => {
    // Word 4.9–5.4 overlaps SPEAKER_00 by 0.1s and SPEAKER_01 by 0.4s → SPEAKER_01.
    const result = mergeTranscriptWithDiarization(whisper([{ word: "boundary", start: 4.9, end: 5.4 }]), spans);
    expect(result).toHaveLength(1);
    expect(result[0].clusterId).toBe("SPEAKER_01");
  });

  it("falls back to the nearest span when a word overlaps nothing", () => {
    const result = mergeTranscriptWithDiarization(whisper([{ word: "tail", start: 10.5, end: 10.8 }]), spans);
    expect(result[0].clusterId).toBe("SPEAKER_01");
    // Nearest-window guesses get the low confidence floor.
    expect(result[0].confidence).toBeCloseTo(0.4, 5);
  });

  it("attributes everything to a single fallback speaker when there is no diarization", () => {
    const result = mergeTranscriptWithDiarization(
      whisper([
        { word: "solo", start: 0.1, end: 0.5 },
        { word: "meeting", start: 0.6, end: 1.0 }
      ]),
      []
    );
    expect(result).toHaveLength(1);
    expect(result[0].clusterId).toBe("SPEAKER_00");
    expect(result[0].text).toBe("solo meeting");
  });

  it("splits a same-speaker monologue on a long silent gap", () => {
    const result = mergeTranscriptWithDiarization(
      whisper([
        { word: "first", start: 0.1, end: 0.5 },
        { word: "part", start: 0.6, end: 1.0 },
        { word: "second", start: 3.5, end: 3.9 }
      ]),
      [{ speaker: "SPEAKER_00", start: 0, end: 5 }]
    );
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("first part");
    expect(result[1].text).toBe("second");
  });
});
