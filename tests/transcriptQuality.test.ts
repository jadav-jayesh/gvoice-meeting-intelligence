import { describe, expect, it } from "vitest";
import { assessWhisperReliability } from "../src/processing/transcriptQuality";
import type { CaptionTimelineEntry, DiarizedTranscriptSegment } from "../src/types/meeting";

function seg(text: string, start: number, end: number): DiarizedTranscriptSegment {
  return { speaker: "Ruchit", clusterId: "SPEAKER_00", text, startTime: start, endTime: end };
}

function caption(text: string): CaptionTimelineEntry {
  return { speaker: "Ruchit", text, time: new Date(), source: "ui_caption" };
}

// The real failure from session 07304ce6: Gujarati audio, Whisper hallucinated
// "Apne apne" ×4 (~3.5s total) against ~40s of detected speech and 19 captions.
const HALLUCINATED = [
  seg("Apne apne", 29.44, 29.98),
  seg("Apne apne", 59.82, 59.96),
  seg("Apne apne", 88.54, 89.94),
  seg("Apne apne", 92.44, 93.84)
];
const RICH_CAPTIONS = [
  caption("Hello guys."),
  caption("So Google me sorry micro"),
  caption("Sorry Microsoft Teams me and check complete transcript text summary but she diarization transcript MOM report I will"),
  caption("I will do proper Azure response is under tiecheck and I"),
  caption("Non-english language order."),
  caption("My transcript English my translator transcript text"),
  caption("So you will check this.")
];

describe("assessWhisperReliability", () => {
  it("flags the hallucinated-identical-repeats failure (the 'Apne apne' session)", () => {
    const result = assessWhisperReliability(HALLUCINATED, RICH_CAPTIONS, 39.9);
    expect(result.unreliable).toBe(true);
    expect(result.reason).toBe("hallucinated_repeats");
  });

  it("flags tiny speech coverage when captions are far richer", () => {
    const sparse = [seg("hello there", 10, 11), seg("ok thanks", 50, 51.5)];
    const result = assessWhisperReliability(sparse, RICH_CAPTIONS, 40);
    expect(result.unreliable).toBe(true);
    expect(result.reason).toBe("low_speech_coverage");
  });

  it("trusts a healthy transcript with good coverage (the English session shape)", () => {
    const healthy = [
      seg("OK so today we will be testing the Azure flow", 6.2, 11.1),
      seg("Yesterday we did some flow regarding the transcripts", 22.7, 25.9),
      seg("Properly Gujarati and Hindi transcript text but we are not achieving that output", 28.4, 39.6),
      seg("OK so today we are testing the Azure Whisper flow again from scratch", 47.9, 55.9)
    ];
    const result = assessWhisperReliability(healthy, RICH_CAPTIONS, 34.4);
    expect(result.unreliable).toBe(false);
  });

  it("does NOT fall back when captions are not meaningfully richer than the transcript", () => {
    // Sparse transcript but equally sparse captions — replacing one with the
    // other gains nothing; keep the provider output.
    const sparse = [seg("hello", 10, 10.5)];
    const result = assessWhisperReliability(sparse, [caption("hello")], 40);
    expect(result.unreliable).toBe(false);
  });

  it("does NOT flag a short legitimate meeting (few segments, repeated greeting is fine under 3)", () => {
    const short = [seg("Hello hello", 1, 2), seg("Hello hello", 5, 6)];
    const result = assessWhisperReliability(short, RICH_CAPTIONS, 4);
    expect(result.unreliable).toBe(false);
  });

  it("returns not-unreliable for an empty transcript (the length===0 branch owns that case)", () => {
    const result = assessWhisperReliability([], RICH_CAPTIONS, 40);
    expect(result.unreliable).toBe(false);
  });
});
