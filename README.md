# gVoice Meeting Intelligence Backend

TypeScript/Node backend for AI meeting intelligence across Google Meet, Microsoft Teams, and Zoom.

## What It Builds

- `POST /bots` creates a MongoDB bot session and queues a BullMQ job.
- For Google Meet and Zoom, a worker launches Chromium with Playwright, joins the meeting, turns mic/camera off, enables captions, captures participant/caption hints, records browser video, records system audio with ffmpeg, merges the final MP4, and trims pre-join time.
- For Microsoft Teams, `TEAMS_MODE` controls behavior. `hybrid` opens the browser bot to join and record, then prefers Microsoft Graph transcript if available and falls back to the recorded audio transcript. `graph_transcript` uses SDK-only transcript ingestion with delayed retries. `browser_live` uses only the browser recording/transcription path.
- Audio is extracted, speech is detected, English audio is sent to Azure OpenAI transcription, multilingual/codemix audio can be routed to Sarvam diarization, speakers are conservatively mapped to real participants, transcript text is generated from finalized diarized segments, summary/action items are generated with Azure OpenAI, and artifacts are uploaded to Azure Blob Storage with SAS URLs.
- MongoDB stores the full meeting intelligence record.

## Quick Start

```bash
cp .env.example .env
docker compose up -d mongo redis
npm install
npx playwright install chromium
npm run dev
```

API:

```bash
curl -X POST http://localhost:3000/bots \
  -H 'content-type: application/json' \
  -d '{
    "platform": "google_meet",
    "meetingUrl": "https://meet.google.com/xxx-yyyy-zzz",
    "webhookUrl": "https://example.com/webhook"
  }'
```

Check session:

```bash
curl http://localhost:3000/bots/<sessionId>
```

## Required Production Services

- MongoDB
- Redis
- Chromium dependencies for Playwright
- ffmpeg and ffprobe
- Azure Blob Storage connection string
- Azure OpenAI summary endpoint
- Sarvam API key for transcription/diarization

## Browser Profiles

Google Meet requires a saved Google login session. Run Chromium headed once with the same profile directory and sign in:

```bash
npm run google:login
```

Keep the terminal open while signing in. After login is complete, press Enter in the terminal so Chromium closes cleanly and saves the profile. The bot uses `GOOGLE_USER_DATA_DIR`, which defaults to `.data/browser-profiles/google`.

Teams and Zoom also use persistent profiles so cookies, permissions, and web-client preferences can stabilize over time.

Microsoft Teams now uses Microsoft Graph SDK instead of the browser bot path. Configure an Entra app with Graph application permissions for online meeting transcripts, grant tenant admin consent, create the required application access policy for the organizer/user, and set:

```bash
TEAMS_GRAPH_TENANT_ID=...
TEAMS_GRAPH_CLIENT_ID=...
TEAMS_GRAPH_CLIENT_SECRET=...
TEAMS_GRAPH_USER_ID=<organizer user id or UPN>
```

Existing bot credential names are also accepted as aliases for the Graph app credentials:

```bash
TEAMS_BOT_TENANT_ID=...
TEAMS_BOT_APP_ID=...
TEAMS_BOT_APP_PASSWORD=...
```

`TEAMS_GRAPH_USER_ID` is still required because Graph transcript APIs are called under `/users/{userId}/onlineMeetings/...`.

The Teams SDK flow depends on Teams transcript availability. It does not create a browser recording; it uploads transcript JSON/text artifacts after Graph returns transcript content.
Transcript availability is asynchronous in Microsoft Graph. `TEAMS_GRAPH_TRANSCRIPT_TIMEOUT_MS` controls only the short initial/retry polling window. Pending transcripts are not treated as backend failures; delayed retry jobs continue according to `TEAMS_GRAPH_TRANSCRIPT_RETRY_DELAYS_MS` until `TEAMS_GRAPH_TRANSCRIPT_MAX_RETRY_ATTEMPTS`. If Graph never publishes a transcript, the terminal status is `transcript_unavailable`.

## Recording Notes

The service records the browser viewport video through Playwright and system audio through ffmpeg. On Linux, use a PulseAudio/PipeWire monitor source:

```bash
pactl list short sources
```

Set `AUDIO_CAPTURE_SOURCE` to the monitor source that receives Chromium audio. In containerized or headless Linux deployments, run Chromium under a real display server or Xvfb and route browser audio to a PulseAudio/PipeWire sink monitor.

## Environment

Important variables:

- `RUN_WORKER_IN_API=true` runs the BullMQ worker in the API process. Set it to `false` and run `npm run worker` for separate API/worker processes.
- `BROWSER_HEADLESS=false` is recommended while validating meeting joins. Headless mode can work, but system audio capture must be provided by the host audio stack.
- `ALLOW_MOCK_AI=false` keeps missing AI credentials as hard failures. Set to `true` only for local API plumbing tests.
- `TRANSCRIPTION_FORCE_PROVIDER=auto|azure|sarvam` controls transcription routing.
- `ALLOW_LOW_CONFIDENCE_DOMINANCE_MAPPING=false` keeps speaker mapping conservative. Low-confidence unnamed clusters stay as `Speaker A/B`.

Credential shape supported by this repo:

```bash
AZURE_STORAGE_CONNECTION_STRING=...
AZURE_STORAGE_CONTAINER_NAME=gvoice-recordings
AZURE_STORAGE_BASE_PATH=gVoice
SARVAM_API_KEY=...
AZURE_OPENAI_SUMMARY_ENDPOINT=https://<resource>.cognitiveservices.azure.com/openai/deployments/<deployment>/chat/completions?api-version=<version>
AZURE_OPENAI_API_KEY=...
```

When `AZURE_OPENAI_TRANSCRIPTION_ENDPOINT` is not set and `TRANSCRIPTION_FORCE_PROVIDER=auto`, transcription routes to Sarvam.

## Data Model

MongoDB sessions contain:

- `sessionId`, `platform`, `meetingUrl`, `status`
- `participants`, `participantsTimeline`
- `captionsTimeline`
- `diarizedTranscript`, `transcriptText`
- `summary`, `actionItems`
- `recordingUrl`, `transcriptUrl`
- `startedAt`, `endedAt`, `errorMessage`
- Teams SDK sessions also store `teamsOnlineMeetingId`, `teamsTranscriptId`, and `transcriptPolling` metadata while waiting for Graph transcript availability.

Statuses:

Browser flow: `queued -> starting -> joining -> recording -> uploading -> processing -> completed`

Teams SDK flow: `queued -> starting -> processing -> awaiting_transcript -> transcript_ready -> processing -> completed`

Teams SDK terminal no-transcript flow: `queued -> starting -> processing -> awaiting_transcript -> transcript_unavailable`

Failures are marked `failed` with stack traces in `errorMessage`.

## Validation Rules

Before `completed`:

- final MP4 must be uploaded
- transcript must exist when speech is detected
- `transcriptText` must be non-empty when speech is detected
- participants must be cleaned and must not be stopwords or generated from transcript text

## Scripts

```bash
npm run dev        # API, optionally worker
npm run worker     # worker only
npm run typecheck  # TypeScript check
npm run build      # compile to dist
npm start          # run compiled API
```
