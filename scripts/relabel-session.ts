import dotenv from "dotenv";

dotenv.config();

import { connectMongo, disconnectMongo } from "../src/db/mongoose";
import { BotSessionModel } from "../src/models/BotSession";
import { buildTranscriptText } from "../src/processing/transcriptText";
import type { DiarizedTranscriptSegment } from "../src/types/meeting";

// One-off data fix: keep the existing participant(s), ADD "Sagar", and reassign
// every transcript segment's speaker to "Sagar" for this session, then rebuild
// transcriptText (it embeds the speaker per line) and sync the timeline + MoM
// attendees so the UI shows consistent names.
const SESSION_ID = process.argv[2] ?? "e9c50a13-a2c4-47d8-b4a8-e66a6ece60cd";
const ADD_SPEAKER = process.argv[3] ?? "Sagar";

function speakerCounts(segments: Array<{ speaker?: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of segments) {
    const key = s.speaker ?? "(none)";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function main(): Promise<void> {
  await connectMongo();
  const session = await BotSessionModel.findOne({ sessionId: SESSION_ID });
  if (!session) {
    console.error(`session ${SESSION_ID} not found`);
    await disconnectMongo();
    process.exit(1);
    return;
  }

  const snapshot = () => ({
    participants: (session.participants ?? []).map((p) => p.name),
    speakers: speakerCounts(session.diarizedTranscript ?? []),
    timeline: (session.participantsTimeline ?? []).map((t) => t.name),
    attendees: (session.momReport?.attendees ?? []).map((a) => a.name),
    transcriptTextLen: session.transcriptText?.length ?? 0
  });
  console.log("BEFORE", JSON.stringify(snapshot(), null, 2));

  // 1. participants — keep existing, add Sagar (dedupe by name)
  if (!(session.participants ?? []).some((p) => p.name === ADD_SPEAKER)) {
    session.participants.push({ name: ADD_SPEAKER } as never);
  }

  // 2. diarizedTranscript — reassign every segment's speaker to Sagar
  for (const seg of session.diarizedTranscript ?? []) seg.speaker = ADD_SPEAKER;
  session.markModified("diarizedTranscript");

  // 3. transcriptText — rebuild (each line is "[ts] <speaker>: text")
  session.transcriptText = buildTranscriptText((session.diarizedTranscript ?? []) as DiarizedTranscriptSegment[]);

  // 4. participantsTimeline — add Sagar mirroring an existing entry / session span
  const tl = session.participantsTimeline ?? [];
  if (!tl.some((t) => t.name === ADD_SPEAKER)) {
    const ref = tl[0];
    session.participantsTimeline.push({
      name: ADD_SPEAKER,
      joinTime: ref?.joinTime ?? session.startedAt ?? new Date(),
      leaveTime: ref?.leaveTime ?? null,
      firstSeen: ref?.firstSeen ?? session.startedAt ?? null,
      lastSeen: ref?.lastSeen ?? session.endedAt ?? null
    } as never);
  }

  // 5. momReport.attendees — add Sagar
  if (session.momReport) {
    if (!(session.momReport.attendees ?? []).some((a) => a.name === ADD_SPEAKER)) {
      session.momReport.attendees.push({ name: ADD_SPEAKER } as never);
    }
    session.markModified("momReport");
  }

  await session.save();

  console.log("AFTER", JSON.stringify({ ...snapshot(), transcriptHead: (session.transcriptText ?? "").slice(0, 200) }, null, 2));
  await disconnectMongo();
  console.log("DONE — relabel saved");
}

main().catch(async (err) => {
  console.error(err);
  await disconnectMongo().catch(() => undefined);
  process.exit(1);
});
