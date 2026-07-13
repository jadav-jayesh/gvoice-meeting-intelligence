import dotenv from "dotenv";
dotenv.config();
import { connectMongo, disconnectMongo } from "../src/db/mongoose";
import { BotSessionModel } from "../src/models/BotSession";

// Scan every session for the data-quality issues we've been fixing.
async function main(): Promise<void> {
  await connectMongo();
  try {
    const sessions = await BotSessionModel.find({}).lean();
    for (const s of sessions) {
      const t = s.diarizedTranscript ?? [];
      const parts = (s.participants ?? []).map((p) => p.name);
      const issues: string[] = [];

      // 1. generic/unmapped speaker labels
      const speakers = [...new Set(t.map((x) => x.speaker))];
      const generic = speakers.filter((sp) => /^speaker\b/i.test(sp) || /^spk/i.test(sp));
      if (generic.length) issues.push(`generic speaker labels: ${generic.join(",")}`);

      // 2. single-speaker collapse (multiple participants but 1 speaker)
      if (t.length > 5 && speakers.length === 1 && parts.length > 1) issues.push(`single-speaker collapse (${speakers[0]}) with ${parts.length} participants`);

      // 3. participant duplicate first-name variants ("Taaif" + "Taaif Dadan")
      const firstTokens = parts.map((p) => (p || "").toLowerCase().split(/\s+/)[0]);
      const dupFirst = firstTokens.filter((x, i) => firstTokens.indexOf(x) !== i);
      if (dupFirst.length) issues.push(`duplicate participant first-names: ${[...new Set(dupFirst)].join(",")}`);

      // 4. speaker labels not in participant list
      const partSet = new Set(parts.map((p) => (p || "").toLowerCase()));
      const orphanSpeakers = speakers.filter((sp) => sp && !/^speaker/i.test(sp) && !partSet.has(sp.toLowerCase()));
      if (orphanSpeakers.length) issues.push(`speakers not in participant list: ${orphanSpeakers.join(",")}`);

      // 5. timestamp range vs recording duration
      if (t.length) {
        const maxEnd = Math.max(...t.map((x) => x.endTime ?? 0));
        const minStart = Math.min(...t.map((x) => x.startTime ?? 0));
        const durS = s.startedAt && s.endedAt ? (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000 : null;
        if (durS && maxEnd > durS + 30) issues.push(`transcript ends ${Math.round(maxEnd)}s but recording ~${Math.round(durS)}s (misaligned)`);
        if (minStart < 0) issues.push(`negative start time ${minStart}`);
        const emptyText = t.filter((x) => !(x.text || "").trim()).length;
        if (emptyText) issues.push(`${emptyText} empty-text segments`);
        const emptySpeaker = t.filter((x) => !(x.speaker || "").trim()).length;
        if (emptySpeaker) issues.push(`${emptySpeaker} empty-speaker segments`);
      }

      // 6. completed but empty transcript
      if (s.status === "completed" && t.length === 0) issues.push("completed but transcript empty");

      const tag = issues.length ? "⚠️" : "✓";
      console.log(`${tag} ${(s.meetingName || "(no name)").slice(0, 28).padEnd(28)} status=${s.status} segs=${t.length} spk=${speakers.length} parts=${parts.length}`);
      for (const i of issues) console.log(`      - ${i}`);
    }
  } finally {
    await disconnectMongo();
  }
}
main().catch((e) => { console.error("ERR:", e instanceof Error ? e.message : e); process.exit(1); });
