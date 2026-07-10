import { AzureOpenAIClient } from "../ai/azureOpenAI";
import type { DiarizedTranscriptSegment } from "../types/meeting";
import type { Transcriber, TranscriptionResult } from "./types";

interface AzureSegment {
  start?: number;
  end?: number;
  text?: string;
  speaker?: string;
  speaker_id?: string;
  confidence?: number;
  no_speech_prob?: number;
}

interface AzureTranscriptionResponse {
  text?: string;
  language?: string;
  segments?: AzureSegment[];
}

export class AzureOpenAITranscriber implements Transcriber {
  constructor(private readonly client = new AzureOpenAIClient()) {}

  async transcribe(audioPath: string): Promise<TranscriptionResult> {
    const raw = (await this.client.transcribeAudio(audioPath)) as AzureTranscriptionResponse;
    const text = raw.text?.trim() ?? "";
    const segments = parseAzureSegments(raw);

    return {
      provider: "azure",
      language: raw.language,
      text,
      segments,
      raw
    };
  }
}

function parseAzureSegments(raw: AzureTranscriptionResponse): DiarizedTranscriptSegment[] {
  if (Array.isArray(raw.segments) && raw.segments.length > 0) {
    return raw.segments
      .map((segment, index) => ({
        speaker: segment.speaker ?? segment.speaker_id ?? "Speaker A",
        text: segment.text?.trim() ?? "",
        startTime: Number(segment.start ?? 0),
        endTime: Number(segment.end ?? segment.start ?? 0),
        confidence: typeof segment.confidence === "number" ? segment.confidence : confidenceFromNoSpeech(segment.no_speech_prob),
        clusterId: segment.speaker_id ?? segment.speaker ?? `azure-${index}`
      }))
      .filter((segment) => segment.text && segment.endTime > segment.startTime);
  }

  if (raw.text?.trim()) {
    return [
      {
        speaker: "Speaker A",
        text: raw.text.trim(),
        startTime: 0,
        endTime: 0.01,
        confidence: 0.5,
        clusterId: "azure-speaker-a"
      }
    ];
  }

  return [];
}

function confidenceFromNoSpeech(noSpeechProb?: number): number | undefined {
  if (typeof noSpeechProb !== "number") return undefined;
  return Math.max(0, Math.min(1, 1 - noSpeechProb));
}
