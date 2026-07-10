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
  hasMeetingEnded(): Promise<boolean>;
  dismissOverlays(): Promise<void>;
  leaveMeeting(): Promise<boolean>;
  close(): Promise<void>;
  // Best-effort meeting name read from the in-meeting page. Returns undefined
  // when the page exposes only a generic app title (e.g. "Microsoft Teams").
  getMeetingName(): Promise<string | undefined>;
}
