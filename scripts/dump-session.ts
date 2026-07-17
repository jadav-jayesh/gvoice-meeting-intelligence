import dotenv from "dotenv";
dotenv.config();
import { connectMongo, disconnectMongo } from "../src/db/mongoose";
import { BotSessionModel } from "../src/models/BotSession";

async function main() {
  const id = process.argv[2];
  await connectMongo();
  const s = await BotSessionModel.findOne({ sessionId: id }).lean();
  if (!s) {
    console.log("NOT FOUND", id);
    await disconnectMongo();
    return;
  }
  console.log("=== SESSION", id, "===");
  console.log("platform:", s.platform, "| status:", s.status);
  console.log("provider:", s.transcriptionProvider, "| meetingLanguage:", s.meetingLanguage);
  console.log("startedAt:", s.startedAt);
  console.log("\n=== participants (join order) ===");
  for (const p of s.participantsTimeline ?? []) {
    console.log(`  ${p.name}  join=${p.joinTime?.toISOString?.() ?? p.joinTime}  firstSeen=${p.firstSeen?.toISOString?.() ?? p.firstSeen}`);
  }
  console.log("\n=== participants list ===", (s.participants ?? []).map((p: any) => p.name).join(", "));

  const segs = s.diarizedTranscript ?? [];
  console.log("\n=== transcript: first 12 segments (speaker | start-end | lang | text) ===");
  for (const seg of segs.slice(0, 12)) {
    const t = (seg.text ?? "").slice(0, 60);
    console.log(`  [${seg.speaker}] ${seg.startTime?.toFixed?.(1)}-${seg.endTime?.toFixed?.(1)} lang=${seg.language ?? "?"} :: ${t}`);
  }
  // language distribution
  const langCount: Record<string, number> = {};
  const scriptCount: Record<string, number> = {};
  for (const seg of segs) {
    langCount[seg.language ?? "?"] = (langCount[seg.language ?? "?"] ?? 0) + 1;
    const txt = seg.text ?? "";
    let script = "other";
    if (/[઀-૿]/.test(txt)) script = "gujarati";
    else if (/[ऀ-ॿ]/.test(txt)) script = "devanagari(hi)";
    else if (/[A-Za-z]/.test(txt)) script = "latin";
    scriptCount[script] = (scriptCount[script] ?? 0) + 1;
  }
  console.log("\n=== segment language tags ===", JSON.stringify(langCount));
  console.log("=== segment SCRIPT distribution ===", JSON.stringify(scriptCount));
  console.log("total segments:", segs.length);
  await disconnectMongo();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
