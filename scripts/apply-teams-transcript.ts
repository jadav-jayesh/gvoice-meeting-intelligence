import dotenv from "dotenv";
dotenv.config();

import { connectMongo, disconnectMongo } from "../src/db/mongoose";
import { BotSessionModel } from "../src/models/BotSession";
import { MicrosoftTeamsSdkService } from "../src/services/microsoftTeamsSdkService";
import { buildTranscriptText } from "../src/processing/transcriptText";
import { reconcileTeamsSegments } from "../src/processing/teamsSpeakerRemap";
import { dedupeParticipants } from "../src/processing/participants";
import { logger } from "../src/utils/logger";

// Replace a session's transcript with the Teams OFFICIAL transcript (correct
// speaker splitting + speakers + text), reconciling speaker names to the stored
// participants. Fixes overlapping/rapid-speech merging. Run AI regen after.
//
//   npx tsx scripts/apply-teams-transcript.ts <sessionId> [--dry-run]
async function main(): Promise<void> {
  const sessionId = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!sessionId) { console.error("usage: tsx scripts/apply-teams-transcript.ts <sessionId> [--dry-run]"); process.exit(1); }

  await connectMongo();
  try {
    const session = await BotSessionModel.findOne({ sessionId });
    if (!session) { console.error(`session ${sessionId} not found`); return; }
    if (!session.teamsOnlineMeetingId) { console.error("not a Teams meeting"); return; }

    const teams = await new MicrosoftTeamsSdkService(logger).collectTranscriptForOnlineMeetingId(session.teamsOnlineMeetingId);
    if (teams.status !== "ready") { console.error(`Teams transcript not ready (status=${teams.status})`); return; }

    // Dedupe the roster to one consistent form — cleanParticipantName reduces
    // "Taaif Dadan" onto "Taaif", so the full-name duplicates collapse away.
    const cleanRoster = dedupeParticipants(session.participants ?? []);
    const participants = cleanRoster.map((p) => p.name).filter(Boolean);
    // Teams timestamps are on the meeting clock; the recording (video) starts
    // when the bot joined. Shift so transcript times match the video. Prefer an
    // explicit empirical offset (--offset=<seconds>, from first-speech onset);
    // fall back to start-time metadata (less reliable — Teams VTT clock differs).
    const offsetArg = process.argv.find((a) => a.startsWith("--offset="));
    const offsetSeconds = offsetArg
      ? Number(offsetArg.split("=")[1])
      : session.startedAt && teams.result.startedAt
        ? (new Date(session.startedAt).getTime() - new Date(teams.result.startedAt).getTime()) / 1000
        : 0;
    console.log(`clock offset applied: ${offsetSeconds.toFixed(1)}s`);
    const segments = reconcileTeamsSegments(teams.result.diarizedTranscript, participants, offsetSeconds);

    const oldCount = (session.diarizedTranscript ?? []).length;
    const spk = segments.reduce<Record<string, number>>((a, s) => { a[s.speaker] = (a[s.speaker] ?? 0) + 1; return a; }, {});
    console.log(`segments: ${oldCount} (audio) -> ${segments.length} (Teams)`);
    console.log("speakers:", JSON.stringify(spk));

    if (dryRun) { console.log("(dry-run — nothing saved)"); return; }

    session.diarizedTranscript = segments;
    session.transcriptText = buildTranscriptText(segments);
    // Rebuild the roster: cleaned attendees + everyone who spoke (reconciled
    // short names), deduped — dedupeParticipants drops the full-name variants.
    const finalParticipants = dedupeParticipants([...cleanRoster, ...segments.map((s) => ({ name: s.speaker }))]);
    session.participants = finalParticipants;
    console.log("participants:", JSON.stringify(finalParticipants.map((p) => p.name)));
    await session.save();
    console.log("saved. transcriptText rebuilt from Teams transcript.");
  } finally {
    await disconnectMongo();
  }
}

main().catch((e) => { console.error("ERR:", e instanceof Error ? e.message : e); process.exit(1); });
