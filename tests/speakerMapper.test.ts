import { describe, expect, it } from "vitest";
import { mapSpeakersToParticipants } from "../src/processing/speakerMapper";
import type { DiarizedTranscriptSegment, Participant } from "../src/types/meeting";
import { logger } from "../src/utils/logger";

function seg(clusterId: string, text: string, start: number): DiarizedTranscriptSegment {
  return { speaker: clusterId, clusterId, text, startTime: start, endTime: start + 2, confidence: 0.9 };
}

describe("mapSpeakersToParticipants — single participant", () => {
  it("collapses every over-segmented cluster to the sole participant (no 'Speaker A')", () => {
    // pyannote over-segmented one voice into SPEAKER_00 + SPEAKER_01, but only
    // Ruchit was in the meeting.
    const transcript = [
      seg("SPEAKER_00", "OK so today we will be testing", 6),
      seg("SPEAKER_01", "Yesterday we did some flow", 22),
      seg("SPEAKER_01", "regenerating everything from scratch", 47)
    ];
    const participants: Participant[] = [{ name: "Ruchit", source: "participant_panel" }];

    const mapped = mapSpeakersToParticipants(transcript, participants, [], logger);

    expect(mapped).toHaveLength(3);
    expect(new Set(mapped.map((s) => s.speaker))).toEqual(new Set(["Ruchit"]));
    // clusterIds are preserved (downstream resolver still keys on them).
    expect(mapped[0].clusterId).toBe("SPEAKER_00");
  });
});

describe("mapSpeakersToParticipants — over-diarization (clusters > participants)", () => {
  const participants: Participant[] = [
    { name: "Jayesh", source: "participant_panel" },
    { name: "Pankaj", source: "participant_panel" }
  ];

  it("assigns leftover clusters real names by turn order instead of 'Speaker A/B/C/D'", () => {
    // Diariser over-segmented 2 people into 4 clusters; no usable caption
    // evidence. Previously every cluster fell through to a generic label.
    const transcript = [
      seg("SPEAKER_00", "હલો", 0),
      seg("SPEAKER_01", "હેલો", 2),
      seg("SPEAKER_02", "ઇંગ્લિશમાં વાત", 8),
      seg("SPEAKER_03", "ને મિક્સ કરવું", 10)
    ];

    const mapped = mapSpeakersToParticipants(transcript, participants, [], logger);

    // No generic labels remain.
    expect(mapped.some((s) => /^Speaker [A-Z]$/.test(s.speaker))).toBe(false);
    expect(new Set(mapped.map((s) => s.speaker))).toEqual(new Set(["Jayesh", "Pankaj"]));
    // Conversational turn order: appearance-ordered clusters cycle over participants.
    expect(mapped.map((s) => s.speaker)).toEqual(["Jayesh", "Pankaj", "Jayesh", "Pankaj"]);
    // clusterIds preserved for downstream.
    expect(mapped[2].clusterId).toBe("SPEAKER_02");
  });

  it("covers an odd surplus cluster (3 clusters, 2 participants)", () => {
    const transcript = [
      seg("SPEAKER_00", "one", 0),
      seg("SPEAKER_01", "two", 2),
      seg("SPEAKER_02", "three", 4)
    ];
    const mapped = mapSpeakersToParticipants(transcript, participants, [], logger);
    expect(mapped.some((s) => /^Speaker [A-Z]$/.test(s.speaker))).toBe(false);
    expect(new Set(mapped.map((s) => s.speaker))).toEqual(new Set(["Jayesh", "Pankaj"]));
  });

  it("does NOT alter the balanced case (clusters == participants still maps each 1:1)", () => {
    const transcript = [seg("SPEAKER_00", "hi", 0), seg("SPEAKER_01", "hey", 2)];
    const mapped = mapSpeakersToParticipants(transcript, participants, [], logger);
    expect(new Set(mapped.map((s) => s.speaker))).toEqual(new Set(["Jayesh", "Pankaj"]));
  });
});
