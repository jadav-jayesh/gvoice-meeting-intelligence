import { describe, expect, it } from "vitest";
import { ActiveSpeakerTracker, buildActiveSpeakerSpans } from "../src/capture/activeSpeakerTracker";

const CAPTURE_MS = 2000;

describe("ActiveSpeakerTracker", () => {
  it("cleans names and drops the recording bot / notetakers from the timeline", () => {
    const tracker = new ActiveSpeakerTracker();
    const t = new Date("2026-07-17T10:00:00.000Z");
    tracker.observe(["Ashok Sachdev", "gVoice", "read.ai meeting notes", "Sapan Soni"], t);
    const names = tracker.values().map((s) => s.name);
    // First-token cleaned; bot ("gVoice") and notetaker ("read.ai …") dropped.
    expect(new Set(names)).toEqual(new Set(["Ashok", "Sapan"]));
  });
});

describe("buildActiveSpeakerSpans", () => {
  const origin = new Date("2026-07-17T10:00:00.000Z").getTime();
  const at = (secondsFromOrigin: number) => new Date(origin + secondsFromOrigin * 1000);

  it("converts samples to recording-relative seconds and merges consecutive same-speaker ticks", () => {
    const samples = [
      { name: "Ashok", time: at(0) },
      { name: "Ashok", time: at(2) },
      { name: "Ashok", time: at(4) },
      { name: "Sapan", time: at(10) }
    ];
    const spans = buildActiveSpeakerSpans(samples, origin, CAPTURE_MS);
    // Three adjacent Ashok ticks merge into one continuous span; Sapan is separate.
    expect(spans).toEqual([
      { speaker: "Ashok", start: 0, end: 6 },
      { speaker: "Sapan", start: 10, end: 12 }
    ]);
  });

  it("does not merge across a gap larger than two capture windows", () => {
    const samples = [
      { name: "Ashok", time: at(0) },
      { name: "Ashok", time: at(20) }
    ];
    const spans = buildActiveSpeakerSpans(samples, origin, CAPTURE_MS);
    expect(spans).toHaveLength(2);
  });

  it("clamps pre-join samples (negative seconds) to the recording start", () => {
    const samples = [{ name: "Ashok", time: at(-1) }];
    const spans = buildActiveSpeakerSpans(samples, origin, CAPTURE_MS);
    // start clamped to 0, end still positive (window survives).
    expect(spans).toEqual([{ speaker: "Ashok", start: 0, end: 1 }]);
  });

  it("returns nothing for an empty timeline", () => {
    expect(buildActiveSpeakerSpans([], origin, CAPTURE_MS)).toEqual([]);
  });
});
