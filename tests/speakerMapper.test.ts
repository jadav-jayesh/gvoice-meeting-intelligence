import { describe, expect, it } from "vitest";
import { mapSpeakersToParticipants } from "../src/processing/speakerMapper";
import type { SpeakerSpan } from "../src/processing/teamsSpeakerRemap";
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

describe("mapSpeakersToParticipants — active-speaker timeline (language-independent)", () => {
  // The 16ac9294 scenario: a Gujarati meeting with 3 people in the room but only
  // 2 diarised voice clusters, and captions too unreliable to name anyone. Before
  // the active-speaker timeline this produced "Speaker A / Speaker B". The
  // highlighted-tile timeline names them correctly without touching the audio.
  const participants: Participant[] = [
    { name: "Ashok", source: "participant_panel" },
    { name: "Sapan", source: "participant_panel" },
    { name: "Vraj", source: "participant_panel" }
  ];

  it("names 2 clusters from 3 participants using active-speaker overlap (no 'Speaker A/B')", () => {
    const transcript = [
      seg("SPEAKER_00", "પછી શું વસ્તુ જોઈશે", 0),
      seg("SPEAKER_00", "મેં તમને વસ્તુ લખેલી", 4),
      seg("SPEAKER_01", "મંડે સુધી આપી દઈશ", 8),
      seg("SPEAKER_01", "LinkedIn નું બની ગયું છે", 12)
    ];
    // Ashok held the speaking ring for the first stretch, Sapan for the second.
    // Vraj never lit up (spoke little / merged), so he simply isn't assigned.
    const activeSpeakerSpans: SpeakerSpan[] = [
      { speaker: "Ashok", start: 0, end: 6 },
      { speaker: "Sapan", start: 8, end: 14 }
    ];

    const mapped = mapSpeakersToParticipants(transcript, participants, [], logger, undefined, [], activeSpeakerSpans);

    expect(mapped.some((s) => /^Speaker [A-Z]$/.test(s.speaker))).toBe(false);
    expect(mapped.map((s) => s.speaker)).toEqual(["Ashok", "Ashok", "Sapan", "Sapan"]);
  });

  it("maps a single voice the diariser split across clusters back to the same person", () => {
    // SPEAKER_00 and SPEAKER_02 are the same voice (Ashok) split by the diariser;
    // SPEAKER_01 is Sapan. Active-speaker is per-time truth, so both Ashok
    // clusters resolve to Ashok even though that breaks a strict 1:1.
    const transcript = [
      seg("SPEAKER_00", "one", 0),
      seg("SPEAKER_01", "two", 4),
      seg("SPEAKER_02", "three", 8)
    ];
    const activeSpeakerSpans: SpeakerSpan[] = [
      { speaker: "Ashok", start: 0, end: 2 },
      { speaker: "Sapan", start: 4, end: 6 },
      { speaker: "Ashok", start: 8, end: 10 }
    ];

    const mapped = mapSpeakersToParticipants(transcript, participants, [], logger, undefined, [], activeSpeakerSpans);

    expect(mapped.map((s) => s.speaker)).toEqual(["Ashok", "Sapan", "Ashok"]);
  });

  it("aligns the two clocks when the recording started after the meeting", () => {
    // Transcript times are recording-relative (t=0 at bot admission); the
    // active-speaker spans here are shifted +100s to simulate a different origin.
    // estimateClockOffset should realign them so overlap still matches.
    const transcript = [seg("SPEAKER_00", "a", 0), seg("SPEAKER_01", "b", 10)];
    const activeSpeakerSpans: SpeakerSpan[] = [
      { speaker: "Ashok", start: 100, end: 104 },
      { speaker: "Sapan", start: 110, end: 114 }
    ];

    const mapped = mapSpeakersToParticipants(transcript, participants, [], logger, undefined, [], activeSpeakerSpans);

    expect(mapped.map((s) => s.speaker)).toEqual(["Ashok", "Sapan"]);
  });
});
