import dotenv from "dotenv";
dotenv.config();
import { connectMongo, disconnectMongo } from "../src/db/mongoose";
import { BotSessionModel } from "../src/models/BotSession";
import { MicrosoftTeamsSdkService } from "../src/services/microsoftTeamsSdkService";
import { estimateClockOffset } from "../src/processing/teamsSpeakerRemap";
import { logger } from "../src/utils/logger";

const mmss = (s: number): string => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

async function main(): Promise<void> {
  const sessionId = process.argv[2];
  const from = Number(process.argv[3] ?? 340);
  const to = Number(process.argv[4] ?? 420);
  await connectMongo();
  try {
    const session = await BotSessionModel.findOne({ sessionId });
    if (!session) { console.error("not found"); return; }
    const cur = (session.diarizedTranscript ?? []).map((s) => ({ speaker: s.speaker, startTime: s.startTime, endTime: s.endTime, text: s.text }));
    const teams = await new MicrosoftTeamsSdkService(logger).collectTranscriptForOnlineMeetingId(session.teamsOnlineMeetingId!);
    if (teams.status !== "ready") { console.error("teams not ready"); return; }
    const tseg = teams.result.diarizedTranscript;
    const offset = estimateClockOffset(cur.map((s) => s.startTime), tseg.map((s) => ({ speaker: s.speaker, start: s.startTime, end: s.endTime })));

    console.log(`clock offset ${offset.toFixed(1)}s | window ${mmss(from)}-${mmss(to)} (audio clock)\n`);
    console.log("=== CURRENT transcript (Sarvam segments + Teams labels) ===");
    for (const s of cur.filter((x) => x.endTime >= from && x.startTime <= to)) console.log(`  [${mmss(s.startTime)}] ${s.speaker}: ${(s.text ?? "").slice(0, 75)}`);
    console.log("\n=== TEAMS official transcript (same window, offset-adjusted) ===");
    for (const s of tseg.filter((x) => x.endTime >= from + offset && x.startTime <= to + offset)) console.log(`  [${mmss(s.startTime - offset)}] ${s.speaker}: ${(s.text ?? "").slice(0, 75)}`);
  } finally {
    await disconnectMongo();
  }
}
main().catch((e) => { console.error("ERR:", e instanceof Error ? e.message : e); process.exit(1); });
