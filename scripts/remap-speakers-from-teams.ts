import dotenv from "dotenv";
dotenv.config();

import { connectMongo, disconnectMongo } from "../src/db/mongoose";
import { BotSessionModel } from "../src/models/BotSession";
import { MicrosoftTeamsSdkService } from "../src/services/microsoftTeamsSdkService";
import { buildTranscriptText } from "../src/processing/transcriptText";
import { remapSpeakersFromTeams } from "../src/processing/teamsSpeakerRemap";
import { logger } from "../src/utils/logger";
import type { DiarizedTranscriptSegment } from "../src/types/meeting";

// Re-label an already-processed session's speakers using the OFFICIAL Teams
// transcript (Microsoft Graph). Keeps existing segment text/timestamps; only
// overwrites each segment's speaker with whoever Teams says was talking then.
//
//   npx tsx scripts/remap-speakers-from-teams.ts <sessionId> [--dry-run]
async function main(): Promise<void> {
  const sessionId = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!sessionId) { console.error("usage: tsx scripts/remap-speakers-from-teams.ts <sessionId> [--dry-run]"); process.exit(1); }

  await connectMongo();
  try {
    const session = await BotSessionModel.findOne({ sessionId });
    if (!session) { console.error(`session ${sessionId} not found`); return; }
    if (!session.teamsOnlineMeetingId) { console.error("session has no teamsOnlineMeetingId — not a Teams meeting"); return; }

    const teams = await new MicrosoftTeamsSdkService(logger).collectTranscriptForOnlineMeetingId(session.teamsOnlineMeetingId);
    if (teams.status !== "ready") { console.error(`Teams transcript not ready (status=${teams.status})`); return; }

    const participants = (session.participants ?? []).map((p) => p.name).filter(Boolean) as string[];
    const segs = (session.diarizedTranscript ?? []).map((seg) =>
      (typeof (seg as { toObject?: () => DiarizedTranscriptSegment }).toObject === "function"
        ? (seg as { toObject: () => DiarizedTranscriptSegment }).toObject()
        : seg) as DiarizedTranscriptSegment
    );

    const count = (list: Array<{ speaker: string }>): Record<string, number> =>
      list.reduce<Record<string, number>>((acc, s) => { acc[s.speaker] = (acc[s.speaker] ?? 0) + 1; return acc; }, {});

    const remapped = remapSpeakersFromTeams(segs, teams.result.diarizedTranscript, participants);
    console.log("BEFORE:", JSON.stringify(count(segs)));
    console.log("AFTER :", JSON.stringify(count(remapped)));

    if (dryRun) { console.log("(dry-run — nothing saved)"); return; }

    session.diarizedTranscript = remapped;
    session.transcriptText = buildTranscriptText(remapped);
    await session.save();
    console.log("saved. transcriptText rebuilt.");
  } finally {
    await disconnectMongo();
  }
}

main().catch((e) => { console.error("ERR:", e instanceof Error ? e.message : e); process.exit(1); });
