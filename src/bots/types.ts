import type { CaptionTimelineEntry } from "../types/meeting";

export interface BotLaunchOptions {
  recordVideoDir: string;
  // Per-session Chromium user-data-dir. When omitted, the bot falls back to
  // its constructor-time template path (env.{GOOGLE,TEAMS,ZOOM}_USER_DATA_DIR).
  // Set this to a cloned-per-session path so concurrent bots don't deadlock
  // on Chromium's SingletonLock.
  userDataDir?: string;
  // PulseAudio sink name to route this Chromium's audio to. When set, gets
  // exported as PULSE_SINK in the Chromium process environment so the bot's
  // audio output stays isolated from other concurrent sessions on the host.
  pulseSink?: string;
}

export interface BotJoinContext {
  meetingPasscode?: string;
}

export interface MeetingBot {
  launch(options: BotLaunchOptions): Promise<void>;
  join(meetingUrl: string, context?: BotJoinContext): Promise<Date>;
  prepareMeetingView(): Promise<void>;
  snapshotParticipants(): Promise<string[]>;
  snapshotCaptions(): Promise<Array<Omit<CaptionTimelineEntry, "source">>>;
  // Display name(s) the meeting UI is currently highlighting as the active
  // speaker (speaking ring / highlighted tile). Best-effort and language-
  // independent; returns [] when no active-speaker signal is exposed. Bots that
  // can't read it inherit the base no-op.
  snapshotActiveSpeakers(): Promise<string[]>;
  hasMeetingEnded(): Promise<boolean>;
  dismissOverlays(): Promise<void>;
  leaveMeeting(): Promise<boolean>;
  close(): Promise<void>;
  // Best-effort meeting name read from the in-meeting page. Returns undefined
  // when the page exposes only a generic app title (e.g. "Microsoft Teams").
  getMeetingName(): Promise<string | undefined>;
}
