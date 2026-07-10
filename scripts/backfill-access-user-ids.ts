import dotenv from "dotenv";

dotenv.config();

import { connectMongo, disconnectMongo } from "../src/db/mongoose";
import { BotSessionModel } from "../src/models/BotSession";

// One-off migration for Phase 2 shared visibility: seed accessUserIds from the
// existing single owner so every pre-existing meeting stays visible to its owner
// once the list/detail queries switch from `userId` to `accessUserIds`.
//
// Idempotent: only touches rows that have a userId but no accessUserIds yet, and
// uses $addToSet so re-running can't create duplicates. Sharing of old meetings
// to other invitees is intentionally NOT backfilled (we never recorded who else
// was invited) — only new meetings get shared going forward.
//
//   npx tsx scripts/backfill-access-user-ids.ts          # apply
//   npx tsx scripts/backfill-access-user-ids.ts --dry    # count only
const DRY = process.argv.includes("--dry");

async function main(): Promise<void> {
  await connectMongo();

  const filter = {
    userId: { $exists: true },
    $or: [{ accessUserIds: { $exists: false } }, { accessUserIds: { $size: 0 } }]
  };

  const pending = await BotSessionModel.countDocuments(filter);
  console.log(`${pending} session(s) need accessUserIds backfilled${DRY ? " (dry run, no writes)" : ""}`);

  if (DRY || pending === 0) {
    await disconnectMongo();
    return;
  }

  // Per-row update (NOT an aggregation-pipeline update — Cosmos's Mongo API
  // doesn't support those): read each row's userId and set accessUserIds=[userId].
  const cursor = BotSessionModel.find(filter).select("_id userId").lean().cursor();
  let changed = 0;
  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    await BotSessionModel.updateOne({ _id: doc._id }, { $set: { accessUserIds: [doc.userId] } });
    changed += 1;
    if (changed % 100 === 0) console.log(`  …${changed}/${pending}`);
  }
  console.log(`DONE — backfilled ${changed} session(s)`);

  await disconnectMongo();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectMongo().catch(() => undefined);
  process.exit(1);
});
