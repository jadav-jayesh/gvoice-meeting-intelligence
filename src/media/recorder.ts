import { readdir } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import { mergeAudioVideo, extractAudioForTranscription, probeDurationSeconds } from "./ffmpeg";
import { SystemAudioRecorder } from "./systemAudioRecorder";
import type { RecordingStopResult, SessionMediaPaths } from "../types/media";
import { logger } from "../utils/logger";

export class MeetingRecorder {
  private audioRecorder: SystemAudioRecorder;
  private recordingStartedAt?: Date;

  // audioSourceOverride pins the audio recorder to a per-session PulseAudio
  // monitor. Undefined keeps the legacy behaviour (env.AUDIO_CAPTURE_SOURCE).
  constructor(private readonly paths: SessionMediaPaths, audioSourceOverride?: string) {
    this.audioRecorder = new SystemAudioRecorder(paths.rawAudioPath, audioSourceOverride);
  }

  async start(): Promise<void> {
    this.recordingStartedAt = new Date();
    await this.audioRecorder.start();
  }

  getStartedAt(): Date | undefined {
    return this.recordingStartedAt;
  }

  // browserStartedAt is the wall-clock moment Playwright began recording the
  // browser video (right after bot.launch resolves). It's used to trim the
  // pre-join waiting-room footage from the front of the video so the final MP4
  // begins at admission, when audio recording started.
  async stop(options: {
    joinedAt?: Date;
    browserStartedAt?: Date;
    finalizeVideo?: () => Promise<void>;
  }): Promise<RecordingStopResult> {
    const rawAudioPath = await this.audioRecorder.stop();
    if (options.finalizeVideo) await options.finalizeVideo();
    const rawVideoPath = await this.findRawVideo();
    const { videoTrimSeconds, audioTrimSeconds } = this.calculateTrims(options.joinedAt, options.browserStartedAt);

    logger.info(
      { rawVideoPath, rawAudioPath, videoTrimSeconds, audioTrimSeconds },
      "merging meeting recording"
    );
    await mergeAudioVideo({
      videoPath: rawVideoPath,
      audioPath: rawAudioPath,
      outputPath: this.paths.finalRecordingPath,
      videoTrimSeconds,
      audioTrimSeconds
    });

    const extracted = await extractAudioForTranscription(this.paths.finalRecordingPath, this.paths.extractedAudioPath);
    const durationSeconds = await probeDurationSeconds(this.paths.finalRecordingPath);

    return {
      rawVideoPath,
      rawAudioPath,
      finalRecordingPath: this.paths.finalRecordingPath,
      extractedAudioPath: extracted ? this.paths.extractedAudioPath : undefined,
      durationSeconds
    };
  }

  // Compute how much to skip from the front of each stream. The orchestrator
  // now starts audio recording AFTER admission, so the audio file already
  // begins at the right point and audioTrimSeconds is 0. The browser video
  // file always begins at browser launch, so we trim it to align with audio.
  private calculateTrims(
    joinedAt: Date | undefined,
    browserStartedAt: Date | undefined
  ): { videoTrimSeconds: number; audioTrimSeconds: number } {
    if (!this.recordingStartedAt) return { videoTrimSeconds: 0, audioTrimSeconds: 0 };

    const videoOrigin = browserStartedAt ?? this.recordingStartedAt;
    // Trim video from its t=0 (browser launch) to the moment audio recording
    // began (post-admission). PRE_JOIN_TRIM_PADDING_SECONDS keeps a small
    // lead-in so the recording doesn't cut a frame too aggressively.
    const rawVideoTrim =
      (this.recordingStartedAt.getTime() - videoOrigin.getTime()) / 1000 - env.PRE_JOIN_TRIM_PADDING_SECONDS;
    const videoTrimSeconds = Math.max(0, rawVideoTrim);

    // Audio was started after admission, so its file is already aligned with
    // joinedAt; no audio trim needed. If for some reason audio started before
    // joinedAt (legacy/unknown timing), fall back to trimming audio too.
    let audioTrimSeconds = 0;
    if (joinedAt && this.recordingStartedAt.getTime() < joinedAt.getTime()) {
      const rawAudioTrim = (joinedAt.getTime() - this.recordingStartedAt.getTime()) / 1000 - env.PRE_JOIN_TRIM_PADDING_SECONDS;
      audioTrimSeconds = Math.max(0, rawAudioTrim);
    }

    return { videoTrimSeconds, audioTrimSeconds };
  }

  private async findRawVideo(): Promise<string> {
    const files = await readdir(this.paths.videoDir);
    const candidates = files
      .filter((file) => /\.(webm|mp4)$/i.test(file))
      .map((file) => path.join(this.paths.videoDir, file));

    if (candidates.length === 0) {
      throw new Error(`No browser video recording found in ${this.paths.videoDir}`);
    }

    return candidates.sort().at(-1) as string;
  }
}
