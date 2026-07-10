import { BotSessionModel } from "../models/BotSession";
import type { BotStatus, MeetingLogEntry, MeetingLogLevel, MeetingLogPhase } from "../types/meeting";

export interface AppendMeetingLogInput {
  level?: MeetingLogLevel;
  phase: MeetingLogPhase;
  event: string;
  message: string;
  status?: BotStatus;
  metadata?: Record<string, unknown>;
}

export async function appendMeetingLog(sessionId: string, input: AppendMeetingLogInput): Promise<MeetingLogEntry> {
  const entry: MeetingLogEntry = {
    time: new Date(),
    level: input.level ?? "info",
    phase: input.phase,
    event: input.event,
    message: input.message,
    status: input.status,
    metadata: input.metadata
  };

  await BotSessionModel.updateOne({ sessionId }, { $push: { meetingLogs: entry } }).exec();
  return entry;
}
