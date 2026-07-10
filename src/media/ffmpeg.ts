import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { env } from "../config/env";
import type { SpeechAnalysis } from "../types/media";
import { logger } from "../utils/logger";

interface RunResult {
  stdout: string;
  stderr: string;
}

export async function runFfmpeg(args: string[], label: string): Promise<RunResult> {
  return runProcess(env.FFMPEG_PATH, args, label);
}

export async function runFfprobe(args: string[], label: string): Promise<RunResult> {
  return runProcess(env.FFPROBE_PATH, args, label);
}

export async function probeDurationSeconds(filePath: string): Promise<number> {
  const result = await runFfprobe(
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
    "ffprobe duration"
  );
  const duration = Number.parseFloat(result.stdout.trim());
  return Number.isFinite(duration) ? duration : 0;
}

export async function mergeAudioVideo(options: {
  videoPath: string;
  audioPath?: string;
  outputPath: string;
  // Trim applied to the Playwright-recorded browser video so the output starts
  // at admission time. Video begins at browser launch, so this skips the
  // pre-join waiting-room footage.
  videoTrimSeconds: number;
  // Trim applied to the system-audio recording. Typically 0 when audio is
  // started only after admission (no pre-join in the audio file at all).
  audioTrimSeconds: number;
}): Promise<void> {
  const videoTrim = Math.max(0, options.videoTrimSeconds).toFixed(3);
  const audioTrim = Math.max(0, options.audioTrimSeconds).toFixed(3);
  const baseVideoArgs = ["-y", "-hide_banner", "-loglevel", "warning", "-ss", videoTrim, "-i", options.videoPath];

  const encodingArgs = [
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart"
  ];

  if (options.audioPath && existsSync(options.audioPath)) {
    await runFfmpeg(
      [
        ...baseVideoArgs,
        "-ss",
        audioTrim,
        "-i",
        options.audioPath,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        ...encodingArgs,
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        options.outputPath
      ],
      "ffmpeg merge audio video"
    );
    return;
  }

  await runFfmpeg([...baseVideoArgs, ...encodingArgs, "-an", options.outputPath], "ffmpeg encode video only");
}

// Grab a single JPEG frame from the recorded meeting video for use as a list
// thumbnail. The frame is taken at `atSeconds` (clamped to a small offset so we
// don't land on a black pre-roll) and scaled to a fixed width while keeping
// the original aspect ratio. Returns true when a thumbnail file was written.
export async function extractVideoThumbnail(
  videoPath: string,
  outputPath: string,
  options: { atSeconds?: number; width?: number } = {}
): Promise<boolean> {
  const at = Math.max(0.5, options.atSeconds ?? 2).toFixed(2);
  const width = Math.max(64, options.width ?? 480);
  try {
    await runFfmpeg(
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-ss",
        at,
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-vf",
        `scale=${width}:-2`,
        "-q:v",
        "3",
        outputPath
      ],
      "ffmpeg extract thumbnail"
    );
    return true;
  } catch (error) {
    logger.warn({ err: error, videoPath }, "thumbnail extraction failed");
    return false;
  }
}

export async function extractAudioForTranscription(videoPath: string, outputPath: string): Promise<boolean> {
  try {
    await runFfmpeg(["-y", "-hide_banner", "-loglevel", "warning", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", outputPath], "ffmpeg extract audio");
    return true;
  } catch (error) {
    logger.warn({ err: error }, "audio extraction failed; recording may not contain audio");
    return false;
  }
}

// Slice a [startSeconds, endSeconds] window out of `inputPath` into a mono
// 16kHz WAV at `outputPath`. Used by the Whisper per-speaker-region decoder so
// each contiguous same-speaker run is transcribed alone (auto-language) and by
// the sparse-rescue path. `-ss` before `-i` enables fast input seeking.
export async function extractAudioSegment(
  inputPath: string,
  startSeconds: number,
  endSeconds: number,
  outputPath: string
): Promise<boolean> {
  const start = Math.max(0, startSeconds);
  const duration = Math.max(0.05, endSeconds - start);
  try {
    await runFfmpeg(
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        start.toFixed(3),
        "-t",
        duration.toFixed(3),
        "-i",
        inputPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        outputPath
      ],
      "ffmpeg extract audio segment"
    );
    return true;
  } catch (error) {
    logger.warn({ err: error, startSeconds: start, endSeconds }, "audio segment extraction failed");
    return false;
  }
}

export async function analyzeSpeech(audioPath: string): Promise<SpeechAnalysis> {
  if (!existsSync(audioPath)) {
    return { durationSeconds: 0, silenceSeconds: 0, speechSeconds: 0, hasSpeech: false };
  }

  const durationSeconds = await probeDurationSeconds(audioPath);
  if (durationSeconds <= 0) {
    return { durationSeconds: 0, silenceSeconds: 0, speechSeconds: 0, hasSpeech: false };
  }

  try {
    const result = await runFfmpeg(
      ["-hide_banner", "-nostats", "-i", audioPath, "-af", "silencedetect=n=-45dB:d=0.8", "-f", "null", "-"],
      "ffmpeg speech analysis"
    );
    const stderr = result.stderr;
    const silenceSeconds = [...stderr.matchAll(/silence_duration:\s*([0-9.]+)/g)].reduce((total, match) => total + Number.parseFloat(match[1]), 0);
    const speechSeconds = Math.max(0, durationSeconds - silenceSeconds);
    return {
      durationSeconds,
      silenceSeconds,
      speechSeconds,
      hasSpeech: speechSeconds >= 4
    };
  } catch (error) {
    logger.warn({ err: error }, "speech analysis failed; treating non-empty audio as speech");
    return {
      durationSeconds,
      silenceSeconds: 0,
      speechSeconds: durationSeconds,
      hasSpeech: durationSeconds >= 4
    };
  }
}

async function runProcess(command: string, args: string[], label: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${label} failed with code ${code}: ${stderr || stdout}`));
      }
    });
  });
}
