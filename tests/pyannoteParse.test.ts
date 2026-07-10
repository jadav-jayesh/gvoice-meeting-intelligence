import { describe, expect, it } from "vitest";
import { parseDiarization } from "../src/transcription/pyannote/pyannoteDiarizationProvider";

describe("parseDiarization", () => {
  it("normalises numeric labels and sorts by start time", () => {
    const spans = parseDiarization({
      diarization: [
        { speaker: "SPEAKER_01", start: 4.2, end: 7.9 },
        { speaker: 0, start: 0, end: 4.2 }
      ]
    });
    expect(spans.map((s) => s.speaker)).toEqual(["SPEAKER_00", "SPEAKER_01"]);
    expect(spans[0].start).toBe(0);
  });

  it("accepts the {segments,label,start_time} shape", () => {
    const spans = parseDiarization({ segments: [{ label: "A", start_time: 0, end_time: 1.5 }] });
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ speaker: "A", start: 0, end: 1.5 });
  });

  it("drops zero/negative-length spans", () => {
    const spans = parseDiarization({ diarization: [{ speaker: "SPEAKER_00", start: 2, end: 2 }] });
    expect(spans).toHaveLength(0);
  });
});
