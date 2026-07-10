import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "../config/env";
import { logger } from "../utils/logger";

const execFileAsync = promisify(execFile);

export interface PerSessionSink {
  sinkName: string;
  monitorSource: string;
  moduleId: number;
}

// Spin up a private PulseAudio null-sink for one bot session. Chromium gets
// launched with PULSE_SINK=<sinkName> so its audio output is isolated; ffmpeg
// records the sink's .monitor source. Returns undefined when the feature is
// disabled, the driver is not pulse, or pactl is unavailable — callers fall
// back to AUDIO_CAPTURE_SOURCE in that case.
export async function loadPerSessionSink(sessionId: string): Promise<PerSessionSink | undefined> {
  if (!env.AUDIO_CAPTURE_PER_SESSION_SINK) return undefined;
  if (env.AUDIO_CAPTURE_DRIVER !== "pulse") return undefined;
  if (!env.AUDIO_CAPTURE_ENABLED) return undefined;

  const safeId = sessionId.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 48);
  const sinkName = `gvoice_${safeId}`;

  try {
    const { stdout } = await execFileAsync("pactl", [
      "load-module",
      "module-null-sink",
      `sink_name=${sinkName}`,
      `sink_properties=device.description=gvoice_${safeId}`
    ]);
    const moduleId = Number.parseInt(stdout.trim(), 10);
    if (!Number.isFinite(moduleId)) {
      logger.warn({ stdout, sessionId }, "pactl load-module returned unparseable module id; falling back to default source");
      return undefined;
    }
    const monitorSource = `${sinkName}.monitor`;
    logger.info({ sessionId, sinkName, monitorSource, moduleId }, "per-session pulseaudio sink loaded");
    return { sinkName, monitorSource, moduleId };
  } catch (error) {
    logger.warn({ err: error, sessionId }, "failed to load per-session pulseaudio sink; falling back to default source");
    return undefined;
  }
}

export async function unloadSink(sink: PerSessionSink | undefined): Promise<void> {
  if (!sink) return;
  try {
    await execFileAsync("pactl", ["unload-module", String(sink.moduleId)]);
    logger.info({ moduleId: sink.moduleId, sinkName: sink.sinkName }, "per-session pulseaudio sink unloaded");
  } catch (error) {
    logger.warn({ err: error, moduleId: sink.moduleId }, "failed to unload per-session pulseaudio sink");
  }
}
