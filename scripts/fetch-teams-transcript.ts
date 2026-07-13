import dotenv from "dotenv";
dotenv.config();

import { MicrosoftTeamsSdkService } from "../src/services/microsoftTeamsSdkService";
import { logger } from "../src/utils/logger";

// Try to fetch the OFFICIAL Teams transcript (accurate speaker names) for an
// online meeting id, retroactively. Proves whether Graph has it now.
async function main(): Promise<void> {
  const onlineMeetingId = process.argv[2];
  if (!onlineMeetingId) {
    console.error("usage: tsx scripts/fetch-teams-transcript.ts <onlineMeetingId>");
    process.exit(1);
  }
  const svc = new MicrosoftTeamsSdkService(logger);
  const result = await svc.collectTranscriptForOnlineMeetingId(onlineMeetingId);
  console.log("status:", result.status);
  const segs = result.status === "ready" ? result.result.diarizedTranscript : [];
  console.log("segments:", segs.length);
  const speakers: Record<string, number> = {};
  for (const s of segs) speakers[s.speaker] = (speakers[s.speaker] ?? 0) + 1;
  console.log("speakers (accurate, from Teams):", JSON.stringify(speakers));
}

main().catch((e) => { console.error("ERR:", e instanceof Error ? e.message : e); process.exit(1); });
