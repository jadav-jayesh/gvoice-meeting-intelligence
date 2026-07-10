import dotenv from "dotenv";

dotenv.config();

import { connectMongo, disconnectMongo } from "../src/db/mongoose";
import { BotSessionModel } from "../src/models/BotSession";
import { buildTranscriptText } from "../src/processing/transcriptText";
import type { DiarizedTranscriptSegment } from "../src/types/meeting";

// Reassign individual transcript segment(s) to a different speaker, matched by a
// text substring. Rebuilds transcriptText (speaker is embedded per line).
//   npx tsx scripts/reassign-segment.ts <sessionId> <newSpeaker> <match text…>
const SESSION_ID = process.argv[2];
const NEW_SPEAKER = process.argv[3];
const MATCH = process.argv.slice(4).join(" ").replace(/\s+/g, " ").trim();

function speakerCounts(segments: Array<{ speaker?: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of segments) {
    const key = s.speaker ?? "(none)";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function main(): Promise<void> {
  if (!SESSION_ID || !NEW_SPEAKER || !MATCH) {
    console.error("Usage: npx tsx scripts/reassign-segment.ts <sessionId> <newSpeaker> <match text…>");
    process.exit(1);
    return;
  }
  await connectMongo();
  const session = await BotSessionModel.findOne({ sessionId: SESSION_ID });
  if (!session) {
    console.error(`session ${SESSION_ID} not found`);
    await disconnectMongo();
    process.exit(1);
    return;
  }

  const segs = session.diarizedTranscript ?? [];
  const matched = segs.filter((s) => (s.text ?? "").replace(/\s+/g, " ").trim().includes(MATCH));

  console.log(`matched ${matched.length} segment(s) for: "${MATCH}"`);
  for (const s of matched) {
    console.log(`  [${s.startTime}-${s.endTime}] ${s.speaker} -> ${NEW_SPEAKER}: ${(s.text ?? "").slice(0, 80)}`);
    s.speaker = NEW_SPEAKER;
  }
  if (matched.length === 0) {
    console.log("nothing matched — no change");
    await disconnectMongo();
    return;
  }

  session.markModified("diarizedTranscript");
  session.transcriptText = buildTranscriptText(segs as DiarizedTranscriptSegment[]);
  await session.save();

  console.log("AFTER speaker counts:", JSON.stringify(speakerCounts(segs)));
  await disconnectMongo();
  console.log("DONE — saved");
}

main().catch(async (err) => {
  console.error(err);
  await disconnectMongo().catch(() => undefined);
  process.exit(1);
});
