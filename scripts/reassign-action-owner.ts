import dotenv from "dotenv";

dotenv.config();

import { connectMongo, disconnectMongo } from "../src/db/mongoose";
import { BotSessionModel } from "../src/models/BotSession";

// Replace the owner on MoM action items (actionItems.owner + actionItems.owners[])
// and topTodos.owner for a session.
//   npx tsx scripts/reassign-action-owner.ts <sessionId> <oldOwner> <newOwner>
const SESSION_ID = process.argv[2];
const OLD = process.argv[3];
const NEW = process.argv[4];

async function main(): Promise<void> {
  if (!SESSION_ID || !OLD || !NEW) {
    console.error("Usage: npx tsx scripts/reassign-action-owner.ts <sessionId> <oldOwner> <newOwner>");
    process.exit(1);
    return;
  }
  await connectMongo();
  const session = await BotSessionModel.findOne({ sessionId: SESSION_ID });
  if (!session?.momReport) {
    console.error(`session ${SESSION_ID} or its momReport not found`);
    await disconnectMongo();
    process.exit(1);
    return;
  }
  const mom = session.momReport;

  const snapshot = () => ({
    actionItems: (mom.actionItems ?? []).map((a) => ({ task: a.task, owner: a.owner, owners: a.owners })),
    topTodos: (mom.topTodos ?? []).map((t) => ({ title: t.title, owner: t.owner }))
  });
  console.log("BEFORE", JSON.stringify(snapshot(), null, 2));

  let changed = 0;
  for (const a of mom.actionItems ?? []) {
    if (a.owner === OLD) { a.owner = NEW; changed += 1; }
    if (Array.isArray(a.owners)) {
      a.owners = a.owners.map((o) => {
        if (o === OLD) { changed += 1; return NEW; }
        return o;
      });
    }
  }
  for (const t of mom.topTodos ?? []) {
    if (t.owner === OLD) { t.owner = NEW; changed += 1; }
  }

  session.markModified("momReport");
  await session.save();

  console.log("AFTER", JSON.stringify(snapshot(), null, 2));
  console.log(`DONE — changed ${changed} owner field(s)`);
  await disconnectMongo();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectMongo().catch(() => undefined);
  process.exit(1);
});
