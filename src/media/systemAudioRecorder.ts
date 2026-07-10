import { execFile, spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { env } from "../config/env";
import { logger } from "../utils/logger";

const execFileAsync = promisify(execFile);

export class SystemAudioRecorder {
  private process?: ChildProcessByStdio<null, Readable, Readable>;
  private stderr = "";

  // sourceOverride lets the orchestrator pin the recorder to a per-session
  // PulseAudio monitor (e.g. "gvoice_<id>.monitor"). When omitted, we fall
  // back to AUDIO_CAPTURE_SOURCE / monitor-source autodetection.
  constructor(
    private readonly outputPath: string,
    private readonly sourceOverride?: string
  ) {}

  async start(): Promise<void> {
    if (!env.AUDIO_CAPTURE_ENABLED || env.AUDIO_CAPTURE_DRIVER === "none") {
      logger.warn("system audio capture disabled");
      return;
    }

    const source = this.sourceOverride ?? (await this.resolveAudioSource());
    const args = this.buildArgs(source);
    logger.info({ driver: env.AUDIO_CAPTURE_DRIVER, source }, "starting system audio capture");

    const child = spawn(env.FFMPEG_PATH, args, { stdio: ["ignore", "pipe", "pipe"] });
    this.process = child;

    child.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString();
    });
    child.stdout.resume();

    await new Promise<void>((resolve, reject) => {
      const startupTimer = setTimeout(resolve, 1500);
      child.once("error", (error) => {
        clearTimeout(startupTimer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(startupTimer);
        reject(new Error(`system audio recorder exited during startup with code ${code}: ${this.stderr}`));
      });
    });
  }

  async stop(): Promise<string | undefined> {
    if (!this.process) return existsSync(this.outputPath) ? this.outputPath : undefined;

    const child = this.process;
    this.process = undefined;

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5000);

      child.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });

      child.kill("SIGINT");
    });

    if (!existsSync(this.outputPath)) {
      logger.warn({ stderr: this.stderr }, "system audio recorder stopped without output");
      return undefined;
    }

    return this.outputPath;
  }

  private buildArgs(source: string): string[] {
    const common = ["-y", "-hide_banner", "-loglevel", "warning"];
    const output = ["-ac", "2", "-ar", "48000", this.outputPath];

    switch (env.AUDIO_CAPTURE_DRIVER) {
      case "pulse":
        return [...common, "-f", "pulse", "-i", source, ...output];
      case "alsa":
        return [...common, "-f", "alsa", "-i", source, ...output];
      case "avfoundation":
        return [...common, "-f", "avfoundation", "-i", source, ...output];
      case "dshow":
        return [...common, "-f", "dshow", "-i", source, ...output];
      default:
        return [...common, "-f", "pulse", "-i", source, ...output];
    }
  }

  private async resolveAudioSource(): Promise<string> {
    if (env.AUDIO_CAPTURE_DRIVER !== "pulse" || env.AUDIO_CAPTURE_SOURCE !== "default") {
      return env.AUDIO_CAPTURE_SOURCE;
    }

    try {
      const { stdout } = await execFileAsync("pactl", ["list", "short", "sources"]);
      const sources = stdout
        .split(/\n+/)
        .map((line) => line.trim().split(/\s+/)[1])
        .filter((source): source is string => Boolean(source));
      const monitorSource = sources.find((source) => source.endsWith(".monitor")) ?? sources.find((source) => source.includes("monitor"));

      if (monitorSource) {
        logger.info({ configuredSource: "default", resolvedSource: monitorSource }, "resolved default PulseAudio source to monitor source");
        return monitorSource;
      }
    } catch (error) {
      logger.warn({ err: error }, "failed to inspect PulseAudio sources; using configured source");
    }

    logger.warn(
      { source: env.AUDIO_CAPTURE_SOURCE },
      "AUDIO_CAPTURE_SOURCE is default and no monitor source was found; recording may not contain meeting audio"
    );
    return env.AUDIO_CAPTURE_SOURCE;
  }
}
