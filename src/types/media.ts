export interface SessionMediaPaths {
  workDir: string;
  videoDir: string;
  rawAudioPath: string;
  finalRecordingPath: string;
  extractedAudioPath: string;
  transcriptJsonPath: string;
  transcriptTextPath: string;
  thumbnailPath: string;
}

export interface RecordingStopResult {
  rawVideoPath: string;
  rawAudioPath?: string;
  finalRecordingPath: string;
  extractedAudioPath?: string;
  durationSeconds: number;
}

export interface SpeechAnalysis {
  durationSeconds: number;
  silenceSeconds: number;
  speechSeconds: number;
  hasSpeech: boolean;
}
