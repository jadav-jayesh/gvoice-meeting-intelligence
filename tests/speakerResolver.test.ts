import { describe, expect, it } from "vitest";
import { applyResolverMappings } from "../src/ai/speakerResolverService";
import type { DiarizedTranscriptSegment } from "../src/types/meeting";

function seg(clusterId: string, speaker: string, text: string, start: number): DiarizedTranscriptSegment {
  return { speaker, clusterId, text, startTime: start, endTime: start + 2, confidence: 0.55 };
}

describe("applyResolverMappings — confident correction can move a name off a coin-flip cluster", () => {
  // The 1b0ef421 flip: deterministic elimination put Jayesh on cluster 2 and Vraj
  // on cluster 1 (a coin flip — both joined at once). Cluster 2 opens with
  // "Hello Jayesh", so the LLM correctly proposes cluster 2 → Vraj @ 0.87. The old
  // code rejected it because cluster 1 already "held" Vraj. It must now swap.
  it("swaps the two clusters when the LLM confidently corrects one of them", () => {
    const transcript = [
      seg("2", "Jayesh", "Hello Jayesh", 0),
      seg("1", "Vraj", "Hi, how are you", 3),
      seg("2", "Jayesh", "I am good", 6),
      seg("1", "Vraj", "Great", 9)
    ];
    const mappings = [{ clusterId: "2", speaker: "Vraj", confidence: 0.87, reason: "opens with 'Hello Jayesh'" }];

    const { transcript: out } = applyResolverMappings(transcript, mappings, ["Jayesh", "Vraj"], new Set());

    const byCluster = Object.fromEntries(out.map((s) => [s.clusterId, s.speaker]));
    expect(byCluster["2"]).toBe("Vraj"); // the one greeting Jayesh
    expect(byCluster["1"]).toBe("Jayesh"); // gets the freed name by elimination
  });

  it("does NOT move a name off a LOCKED (high-confidence) cluster", () => {
    const transcript = [seg("1", "Ashok", "one", 0), seg("2", "Sapan", "two", 3)];
    // LLM wrongly wants cluster 2 → Ashok, but cluster 1 (Ashok) is locked.
    const mappings = [{ clusterId: "2", speaker: "Ashok", confidence: 0.99, reason: "" }];

    const { transcript: out } = applyResolverMappings(transcript, mappings, ["Ashok", "Sapan"], new Set(["1"]));

    const byCluster = Object.fromEntries(out.map((s) => [s.clusterId, s.speaker]));
    expect(byCluster["1"]).toBe("Ashok");
    expect(byCluster["2"]).toBe("Sapan"); // unchanged; locked name protected
  });

  it("leaves correct deterministic labels untouched when the model proposes nothing", () => {
    const transcript = [seg("1", "Ashok", "one", 0), seg("2", "Sapan", "two", 3)];
    const { transcript: out } = applyResolverMappings(transcript, [], ["Ashok", "Sapan"], new Set());
    const byCluster = Object.fromEntries(out.map((s) => [s.clusterId, s.speaker]));
    expect(byCluster["1"]).toBe("Ashok");
    expect(byCluster["2"]).toBe("Sapan");
  });
});
