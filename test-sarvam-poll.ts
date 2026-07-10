import { SarvamAIClient } from "sarvamai";
import { env } from "./src/config/env";
import { readFile } from "fs/promises";

async function run() {
  const client = new SarvamAIClient({ apiSubscriptionKey: env.SARVAM_API_KEY });
  const jobId = '20260507_6752ddc4-478d-4922-b089-0160b2075d51'; // From previous test
  const job = client.speechToTextJob.getJob(jobId);
  
  // We didn't upload a file in the last test! 
  // Let's create a new job, upload a tiny audio file, and poll.
}

run().catch(console.error);
