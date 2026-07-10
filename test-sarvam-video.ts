import { SarvamTranscriber } from "./src/transcription/sarvamTranscriber";
import { analyzeSpeech, extractAudioForTranscription } from "./src/media/ffmpeg";
import { execFileSync } from "child_process";
import { env } from "./src/config/env";

async function run() {
  const url = "https://cccontrolobsstore.blob.core.windows.net/gvoice-recordings/gVoice/meetings/bb829fb3-5edf-49b8-abe1-cdf4fc588cd0/recordings/recording.mp4?sv=2026-02-06&st=2026-05-07T12%3A05%3A16Z&se=2026-05-08T12%3A06%3A16Z&sr=b&sp=r&sig=djRAetXGAaT4FTnW%2F%2BqVw6P1IY0zWaGn%2BQjT3Ago03U%3D";
  console.log("Downloading video...");
  execFileSync("curl", ["-o", "test.mp4", url]);
  
  console.log("Extracting audio...");
  const audioPath = await extractAudioForTranscription("test.mp4", "test_audio.wav");
  
  console.log("Analyzing speech...");
  const speech = await analyzeSpeech(audioPath);
  console.log("Speech Analysis:", speech);
  
  if (speech.hasSpeech) {
    console.log("Transcribing with Sarvam...");
    const transcriber = new SarvamTranscriber();
    try {
      const result = await transcriber.transcribe(audioPath);
      console.log("Segments:", result.segments.length);
      console.log("First 3 Segments:", result.segments.slice(0, 3));
    } catch (e: any) {
      console.error("Sarvam Error:", e.message || e);
    }
  } else {
    console.log("NO SPEECH DETECTED BY FFMPEG SILENCEDETECT!");
  }
}

run().catch(console.error);
