import { execFile, spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { env } from "../config/env";
import { logger } from "../utils/logger";

const execFileAsync = promisify(execFile);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

    // A freshly created per-session null-sink's `.monitor` source isn't always
    // readable the instant the sink loads — ffmpeg then dies at startup with
    // "monitor: Input/output error", failing the whole meeting (observed ~6×/2d
    // in prod, e.g. session c50703a3). Wait for the source to actually register,
    // then retry a transient startup failure a few times before giving up.
    if (env.AUDIO_CAPTURE_DRIVER === "pulse") {
      await this.waitForPulseSource(source);
    }

    const MAX_ATTEMPTS = 4;
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        await this.spawnAndAwaitStartup(args);
        if (attempt > 1) logger.info({ attempt }, "system audio capture started after retry");
        return;
      } catch (error) {
        lastError = error;
        this.killProcess();
        if (attempt >= MAX_ATTEMPTS) break;
        logger.warn({ attempt, err: error }, "system audio recorder startup failed; retrying");
        await delay(600 * attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  // Spawn ffmpeg and resolve once it has survived the startup window; reject if
  // it errors or exits before then (so the caller can retry).
  private spawnAndAwaitStartup(args: string[]): Promise<void> {
    this.stderr = "";
    const child = spawn(env.FFMPEG_PATH, args, { stdio: ["ignore", "pipe", "pipe"] });
    this.process = child;
    child.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString();
    });
    child.stdout.resume();

    return new Promise<void>((resolve, reject) => {
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

  private killProcess(): void {
    if (this.process) {
      try {
        this.process.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      this.process = undefined;
    }
  }

  // Poll until the PulseAudio source (e.g. the per-session monitor) shows up, so
  // ffmpeg doesn't race a not-yet-registered source. Best-effort with a short
  // bound; returns regardless so recording still attempts if pactl is unavailable.
  private async waitForPulseSource(source: string): Promise<void> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        const { stdout } = await execFileAsync("pactl", ["list", "short", "sources"]);
        const present = stdout
          .split(/\n+/)
          .map((line) => line.trim().split(/\s+/)[1])
          .some((name) => name === source);
        if (present) {
          if (attempt > 0) logger.info({ source, attempt }, "pulse source became available");
          return;
        }
      } catch {
        return; // pactl unavailable — don't block recording
      }
      await delay(250);
    }
    logger.warn({ source }, "pulse source not visible after wait; attempting capture anyway");
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
