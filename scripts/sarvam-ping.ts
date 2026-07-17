import dotenv from "dotenv";
dotenv.config();
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SarvamAIClient } from "sarvamai";
import { extractAudioSegment } from "../src/media/ffmpeg";

// Tests a Sarvam API key end-to-end (credits + transcription) on a short clip of
// a session's recording, WITHOUT touching any stored config.
//   npx tsx scripts/sarvam-ping.ts <apiKey> <sessionId> [languageCode]
async function main() {
  const [apiKey, sessionId, languageCode = "gu-IN"] = process.argv.slice(2);
  if (!apiKey || !sessionId) {
    console.log("usage: sarvam-ping.ts <apiKey> <sessionId> [languageCode]");
    return;
  }
  const audioPath = path.resolve(`.data/sessions/${sessionId}/speech.wav`);
  const dir = await mkdtemp(path.join(os.tmpdir(), "sarvam-ping-"));
  const clip = path.join(dir, "clip.wav");
  const ok = await extractAudioSegment(audioPath, 20, 45, clip).catch(() => false);
  if (!ok) {
    console.log("could not extract clip from", audioPath);
    return;
  }

  const client = new SarvamAIClient({ apiSubscriptionKey: apiKey });
  const outDir = path.join(dir, "out");
  try {
    const init = await client.speechToTextJob.initialise({
      job_parameters: {
        model: "saarika:v2.5",
        language_code: languageCode as "unknown",
        with_diarization: true,
        with_timestamps: true
      } as any
    });
    const job = client.speechToTextJob.getJob(init.job_id);
    await job.uploadFiles([clip]);
    await job.start();
    await job.waitUntilComplete();
    const results = await job.getFileResults();
    console.log("KEY OK — credits present.");
    console.log("failed files:", results.failed.length, "| successful:", results.successful.length);
    await job.downloadOutputs(outDir).catch(() => undefined);
    const { readdir, readFile } = await import("node:fs/promises");
    const files = await readdir(outDir).catch(() => [] as string[]);
    const jsonFile = files.find((f) => f.endsWith(".json"));
    if (jsonFile) {
      const raw = JSON.parse(await readFile(path.join(outDir, jsonFile), "utf8"));
      console.log("detected language_code:", raw.language_code);
      console.log("transcript sample:", (raw.transcript ?? "").slice(0, 200));
    }
  } catch (error: any) {
    console.log("KEY TEST FAILED:", error?.message ?? String(error));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
