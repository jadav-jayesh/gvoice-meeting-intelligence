import { cleanParticipantName, isBotParticipantName } from "../processing/participants";
import type { SpeakerSpan } from "../processing/teamsSpeakerRemap";

// One observation of "this display name was the active (highlighted) speaker at
// this wall-clock instant". Sampled from the meeting UI's own active-speaker
// indicator (the speaking ring / highlighted tile) every capture tick.
export interface ActiveSpeakerSample {
  name: string;
  time: Date;
}

// Captures the meeting platform's OWN "who is speaking now" signal — the
// highlighted video tile / speaking ring — as a timeline of {name, time}
// samples. This is the same ground-truth signal Otter/Fireflies/read.ai use to
// name speakers, and it is LANGUAGE-INDEPENDENT: it reads the participant's
// display name off the UI, not the audio, so it works for Gujarati/Hindi/mixed
// meetings where caption-based attribution is unreliable. Post-meeting, the
// samples are turned into speaker spans and time-aligned onto the diarised
// transcript (see buildActiveSpeakerSpans + the active-speaker phase in
// speakerMapper).
export class ActiveSpeakerTracker {
  private readonly samples: ActiveSpeakerSample[] = [];

  // Record the active speaker(s) observed at `at`. Names are cleaned and bot /
  // notetaker labels dropped so the recording bot itself (gVoice) and other AI
  // notetakers never pollute the speaker timeline. Multiple names are allowed
  // per tick (some clients briefly highlight two tiles on speaker switch).
  observe(rawNames: string[], at: Date = new Date()): void {
    for (const rawName of rawNames) {
      if (isBotParticipantName(rawName)) continue;
      const name = cleanParticipantName(rawName);
      if (!name) continue;
      this.samples.push({ name, time: at });
    }
  }

  values(): ActiveSpeakerSample[] {
    return [...this.samples].sort((a, b) => a.time.getTime() - b.time.getTime());
  }

  size(): number {
    return this.samples.length;
  }
}

// Convert point-in-time active-speaker samples into contiguous speaker spans (in
// SECONDS relative to `originMs`, typically the bot's join time) suitable for
// time-overlap matching against the diarised transcript. Each sample covers a
// window of `windowMs` (the capture interval); consecutive same-speaker samples
// within a small gap are merged into one span so brief sampling gaps don't
// fragment a continuous turn.
export function buildActiveSpeakerSpans(
  samples: ActiveSpeakerSample[],
  originMs: number,
  windowMs: number
): SpeakerSpan[] {
  if (samples.length === 0) return [];
  const windowSec = Math.max(0.5, windowMs / 1000);
  const mergeGapSec = windowSec * 2;

  const ordered = [...samples].sort((a, b) => a.time.getTime() - b.time.getTime());
  const spans: SpeakerSpan[] = [];

  for (const sample of ordered) {
    const start = (sample.time.getTime() - originMs) / 1000;
    const end = start + windowSec;
    const last = spans[spans.length - 1];
    if (last && last.speaker === sample.name && start - last.end <= mergeGapSec) {
      // Same speaker, adjacent in time — extend the current span.
      last.end = Math.max(last.end, end);
    } else {
      spans.push({ speaker: sample.name, start, end });
    }
  }

  // Drop spans that end before the recording clock began (negative) — those
  // samples were taken during pre-join and can't align to any audio segment.
  return spans.filter((span) => span.end > 0).map((span) => ({ ...span, start: Math.max(0, span.start) }));
}
