import dotenv from "dotenv";

dotenv.config();

import { connectMongo, disconnectMongo } from "../src/db/mongoose";
import { BotSessionModel } from "../src/models/BotSession";
import { mapSpeakersToParticipants } from "../src/processing/speakerMapper";
import { logger } from "../src/utils/logger";

// One-off: re-run speaker→participant mapping over EXISTING diarized transcripts
// and persist the result. Picks up the over-diarization fix (Phase D) for
// meetings recorded before it shipped, so transcripts that show generic
// "Speaker A/B/C" get real participant names. Cheap: in-memory remap only — no
// re-transcription, no AI, no bot. Idempotent: only rewrites a session when the
// mapping actually changes a label, so re-running is a no-op.
//
//   npx tsx scripts/backfill-speaker-names.ts --dry   # report only
//   npx tsx scripts/backfill-speaker-names.ts         # apply
const DRY = process.argv.includes("--dry");
const GENERIC = /^Speaker [A-Z]$/;

async function main(): Promise<void> {
  await connectMongo();

  // Candidates: have a diarized transcript and at least one known participant.
  const cursor = BotSessionModel.find({
    "diarizedTranscript.0": { $exists: true },
    "participants.0": { $exists: true }
  })
    .select("sessionId participants captionsTimeline diarizedTranscript participantsTimeline startedAt")
    .lean()
    .cursor();

  let scanned = 0;
  let changed = 0;
  for (let s: any = await cursor.next(); s != null; s = await cursor.next()) {
    scanned += 1;
    const before: string[] = (s.diarizedTranscript ?? []).map((d: any) => d.speaker);
    const hadGeneric = before.some((sp) => GENERIC.test(sp));
    if (!hadGeneric) continue; // already named — nothing to fix

    const remapped = mapSpeakersToParticipants(
      s.diarizedTranscript ?? [],
      s.participants ?? [],
      s.captionsTimeline ?? [],
      logger,
      s.startedAt ? new Date(s.startedAt) : undefined,
      s.participantsTimeline ?? []
    );
    const after = remapped.map((d) => d.speaker);

    // Only write when something actually changed and the result removed at least
    // one generic label (avoid pointless writes / no-op churn).
    const diff = after.some((sp, i) => sp !== before[i]);
    const stillGeneric = after.some((sp) => GENERIC.test(sp));
    if (!diff) continue;

    changed += 1;
    console.log(
      `${s.sessionId.slice(0, 8)} (${(s.participants ?? []).map((p: any) => p.name).join(",")}): ` +
        `[${[...new Set(before)].join(", ")}] -> [${[...new Set(after)].join(", ")}]` +
        (stillGeneric ? "  (some still generic — insufficient evidence)" : "")
    );
    if (!DRY) {
      await BotSessionModel.updateOne({ _id: s._id }, { $set: { diarizedTranscript: remapped } });
    }
  }

  console.log(`\n${DRY ? "[dry run] " : ""}scanned ${scanned}, ${DRY ? "would update" : "updated"} ${changed}`);
  await disconnectMongo();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectMongo().catch(() => undefined);
  process.exit(1);
});
