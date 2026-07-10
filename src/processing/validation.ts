import { isStopwordParticipant } from "./participants";
import type { MeetingIntelligenceResult } from "../types/meeting";

export function validateCompletion(
  result: MeetingIntelligenceResult,
  evidence: { speechExists: boolean; captionSpeechExists?: boolean; requireRecording?: boolean; allowEmptyTranscript?: boolean }
): void {
  if (evidence.requireRecording !== false && !result.recordingUrl) throw new Error("Cannot complete session: recording upload is missing");
  // Always-succeed policy (ALWAYS_COMPLETE_MEETINGS): when every transcription
  // engine AND the caption fallback have been exhausted, an empty transcript is
  // not a failure — the meeting still completes with whatever was recovered.
  // The recording-missing and stopword guards below remain hard failures because
  // those signal a real infra/data bug, not "the audio couldn't be transcribed".
  if (!evidence.allowEmptyTranscript) {
    if (evidence.speechExists && result.diarizedTranscript.length === 0) {
      throw new Error(
        evidence.captionSpeechExists
          ? "Cannot complete session: captions prove speech occurred but diarized transcript is empty"
          : "Cannot complete session: speech detected but transcript is empty"
      );
    }
    if (evidence.speechExists && !result.transcriptText.trim()) {
      throw new Error(
        evidence.captionSpeechExists
          ? "Cannot complete session: captions prove speech occurred but transcriptText is empty"
          : "Cannot complete session: speech detected but transcriptText is empty"
      );
    }
  }
  if (result.participants.some((participant) => isStopwordParticipant(participant.name))) {
    throw new Error("Cannot complete session: participants contain stopword names");
  }
}
