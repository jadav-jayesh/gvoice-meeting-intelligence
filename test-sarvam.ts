import { SarvamAIClient } from "sarvamai";
import { env } from "./src/config/env";

async function run() {
  console.log("Testing Sarvam API...");
  const client = new SarvamAIClient({ apiSubscriptionKey: env.SARVAM_API_KEY });
  try {
    const initResponse = await client.speechToTextJob.initialise({
      job_parameters: {
        model: "saaras:v3",
        mode: "codemix",
        language_code: env.SARVAM_LANGUAGE_CODE as any,
        with_diarization: true,
        with_timestamps: true
      }
    });
    console.log("Success:", initResponse);
  } catch (error: any) {
    console.error("Error:", error.message || error);
    console.error("Status:", error.status);
    console.error("Body:", error.body);
  }
}

run().catch(console.error);
