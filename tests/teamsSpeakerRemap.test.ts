import { describe, it, expect } from "vitest";
import { reconcileSpeakerName, estimateClockOffset, remapSpeakersFromTeams, reconcileTeamsSegments } from "../src/processing/teamsSpeakerRemap";
import type { DiarizedTranscriptSegment } from "../src/types/meeting";

function seg(speaker: string, text: string, startTime: number, endTime: number): DiarizedTranscriptSegment {
  return { speaker, text, startTime, endTime, confidence: 0.9 } as DiarizedTranscriptSegment;
}

describe("reconcileSpeakerName", () => {
  it("matches a Teams full name to a stored first name", () => {
    expect(reconcileSpeakerName("Sagar Patel", ["Ashok", "Sagar", "Taaif", "Ali"])).toBe("Sagar");
    expect(reconcileSpeakerName("Ali Cheikhali", ["Ashok", "Sagar", "Taaif", "Ali"])).toBe("Ali");
  });
  it("falls back to the Teams first name when no participant matches", () => {
    expect(reconcileSpeakerName("Dana Scott", ["Ashok", "Sagar"])).toBe("Dana");
  });
});

describe("estimateClockOffset", () => {
  it("aligns the earliest timestamps (bot joins after meeting start)", () => {
    expect(estimateClockOffset([307, 400], [{ speaker: "A", start: 336, end: 340 }])).toBeCloseTo(29);
  });
});

describe("remapSpeakersFromTeams", () => {
  const participants = ["Ashok", "Sagar", "Taaif", "Ali"];

  it("overwrites guessed speakers with the time-aligned Teams speaker (offset-corrected)", () => {
    // Audio clock is 30s behind Teams. The presenter block was mislabelled Ashok.
    const audio = [seg("Ashok", "so basically you are a technology company", 300, 320), seg("Ali", "hello", 330, 332)];
    const teams = [
      { speaker: "Sagar Patel", startTime: 330, endTime: 352 },
      { speaker: "Ali Cheikhali", startTime: 360, endTime: 363 }
    ];
    const out = remapSpeakersFromTeams(audio, teams as never, participants);
    expect(out[0].speaker).toBe("Sagar"); // was Ashok
    expect(out[1].speaker).toBe("Ali");
    expect(out[0].text).toBe("so basically you are a technology company"); // text preserved
  });

  it("assigns gap segments to the nearest Teams speaker (no stale labels kept)", () => {
    const audio = [seg("Ashok", "short aside", 500, 501)];
    const teams = [{ speaker: "Sagar Patel", startTime: 400, endTime: 480 }, { speaker: "Ali Cheikhali", startTime: 700, endTime: 800 }];
    const out = remapSpeakersFromTeams(audio, teams as never, participants);
    expect(out[0].speaker).toBe("Sagar"); // nearest span, not the stale "Ashok"
  });

  it("is a no-op when there is no Teams transcript", () => {
    const audio = [seg("Ashok", "hi", 0, 1)];
    expect(remapSpeakersFromTeams(audio, [], participants)).toEqual(audio);
  });
});

describe("reconcileTeamsSegments (adopt Teams transcript wholesale)", () => {
  const participants = ["Ashok", "Sagar", "Taaif", "Ali"];

  it("keeps Teams' fine-grained per-speaker splitting and reconciles names", () => {
    // A rapid exchange Teams splits into 3 turns; audio would have merged it.
    const teams = [
      seg("Sagar Patel", "Hey, hey, Ali.", 361, 362),
      seg("Ali Cheikhali", "Hi, how are you?", 362, 364),
      seg("Sagar Patel", "Good. How about you?", 364, 366)
    ];
    const out = reconcileTeamsSegments(teams, participants);
    expect(out.map((s) => s.speaker)).toEqual(["Sagar", "Ali", "Sagar"]); // split preserved, names reconciled
    expect(out.map((s) => s.text)).toEqual(["Hey, hey, Ali.", "Hi, how are you?", "Good. How about you?"]);
    expect(out.every((s) => s.clusterId === s.speaker)).toBe(true);
  });

  it("shifts timestamps to the recording clock and drops pre-recording segments", () => {
    const teams = [
      seg("Ali Cheikhali", "before the bot joined", 10, 15), // ends before offset → dropped
      seg("Sagar Patel", "first captured line", 337, 340)
    ];
    const out = reconcileTeamsSegments(teams, ["Sagar", "Ali"], 30);
    expect(out).toHaveLength(1); // pre-recording segment dropped
    expect(out[0].speaker).toBe("Sagar");
    expect(out[0].startTime).toBeCloseTo(307); // 337 - 30, aligned to the video
    expect(out[0].endTime).toBeCloseTo(310);
  });
});
