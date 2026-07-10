import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import type { SessionMediaPaths } from "../types/media";

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function createSessionMediaPaths(sessionId: string): Promise<SessionMediaPaths> {
  const workDir = path.resolve(env.RECORDING_DIR, sessionId);
  const videoDir = path.join(workDir, "video");
  await ensureDir(videoDir);

  return {
    workDir,
    videoDir,
    rawAudioPath: path.join(workDir, "system-audio.wav"),
    finalRecordingPath: path.join(workDir, "recording.mp4"),
    extractedAudioPath: path.join(workDir, "speech.wav"),
    transcriptJsonPath: path.join(workDir, "transcript.json"),
    transcriptTextPath: path.join(workDir, "transcript.txt"),
    thumbnailPath: path.join(workDir, "thumbnail.jpg")
  };
}

export function sessionBrowserProfilePath(sessionId: string): string {
  return path.resolve(env.RECORDING_DIR, sessionId, "browser-profile");
}

// Clone a template Chromium user-data-dir into a per-session subdir so that
// multiple concurrent browser bots can launch persistent contexts in parallel
// without fighting over Chromium's SingletonLock. The template stays untouched;
// each session gets its own copy of cookies/localStorage/etc.
export async function createSessionBrowserProfile(templateDir: string, sessionId: string): Promise<string> {
  const target = sessionBrowserProfilePath(sessionId);
  await ensureDir(path.dirname(target));
  const resolvedTemplate = path.resolve(templateDir);

  const templateExists = await stat(resolvedTemplate).then((s) => s.isDirectory()).catch(() => false);
  if (templateExists) {
    // Strip the SingletonLock from the clone so Chromium doesn't refuse to
    // launch when the template was last opened by a different session.
    await cp(resolvedTemplate, target, { recursive: true, force: true, errorOnExist: false });
    await rm(path.join(target, "SingletonLock"), { force: true }).catch(() => undefined);
    await rm(path.join(target, "SingletonCookie"), { force: true }).catch(() => undefined);
    await rm(path.join(target, "SingletonSocket"), { force: true }).catch(() => undefined);
  } else {
    await ensureDir(target);
  }
  return target;
}

export async function cleanupSessionBrowserProfile(sessionId: string): Promise<void> {
  const target = sessionBrowserProfilePath(sessionId);
  await rm(target, { recursive: true, force: true }).catch(() => undefined);
}
