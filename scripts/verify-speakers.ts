import dotenv from "dotenv";
dotenv.config();
import { connectMongo, disconnectMongo } from "../src/db/mongoose";
import { BotSessionModel } from "../src/models/BotSession";
import { mapSpeakersToParticipants } from "../src/processing/speakerMapper";
import { SpeakerResolverService } from "../src/ai/speakerResolverService";
import { logger } from "../src/utils/logger";
import type { DiarizedTranscriptSegment } from "../src/types/meeting";

// Verifies the speaker-attribution fix on a finished session WITHOUT re-running
// Sarvam: reconstructs the raw diarised clusters from the stored transcript
// (keeping clusterId + text + timings), then re-runs deterministic mapping +
// the LLM resolver with the CURRENT code. Only touches Azure OpenAI.
async function main() {
  const id = process.argv[2];
  await connectMongo();
  const s = await BotSessionModel.findOne({ sessionId: id }).lean();
  if (!s) {
    console.log("NOT FOUND", id);
    await disconnectMongo();
    return;
  }
  const stored = (s.diarizedTranscript ?? []) as DiarizedTranscriptSegment[];
  const raw: DiarizedTranscriptSegment[] = stored.map((seg) => ({
    ...seg,
    speaker: `Speaker ${seg.clusterId ?? "?"}`,
    clusterId: seg.clusterId
  }));
  const participants = (s.participants ?? []) as any[];
  const show = (label: string, segs: DiarizedTranscriptSegment[]) => {
    console.log(`\n=== ${label} (first 6) ===`);
    for (const seg of segs.slice(0, 6)) {
      console.log(`  [c${seg.clusterId}] ${seg.speaker.padEnd(8)} :: ${(seg.text ?? "").slice(0, 45)}`);
    }
  };

  show("RAW clusters", raw);
  const current = mapSpeakersToParticipants(raw, participants, [], logger, s.startedAt as any, (s.participantsTimeline ?? []) as any);
  show("AFTER deterministic mapping", current);

  const resolved = await new SpeakerResolverService(logger).resolve({
    participants,
    diarizedTranscript: raw,
    captionsTimeline: [],
    currentTranscript: current,
    meetingStartedAt: s.startedAt as any
  });
  show("AFTER LLM resolver (FINAL)", resolved);

  await disconnectMongo();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
