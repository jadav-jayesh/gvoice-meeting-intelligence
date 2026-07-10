# gVoice Pyannote Bridge

A small FastAPI service that wraps the hosted **[pyannote.ai](https://pyannote.ai)**
diarization API behind one synchronous HTTP endpoint, so the Node backend can
diarize meeting audio without implementing the cloud API's upload + async-job
protocol itself.

It is used **only** by the Whisper transcription provider
(`TRANSCRIPTION_PROVIDER=whisper`). The Sarvam flow does its own diarization and
never calls this service.

## Endpoints

| Method | Path       | Body                                    | Response |
| ------ | ---------- | --------------------------------------- | -------- |
| `POST` | `/diarize` | `multipart/form-data` with `file=<wav>` | `{ "diarization": [{ "speaker": "SPEAKER_00", "start": 0.0, "end": 4.2 }], "num_speakers": 2 }` |
| `GET`  | `/health`  | —                                       | `{ "status": "ok", "base_url": "...", "configured": true }` |

Internally `/diarize` (1) requests a pre-signed upload URL, (2) uploads the
audio, (3) starts a diarization job, and (4) polls until it finishes.

## Setup

1. Get a pyannote.ai API key (`sk_...`) from <https://dashboard.pyannote.ai>.
2. `bridge/pyannote/.env` already exists in this repo — make sure
   `PYANNOTE_API_KEY` is set (the same key as in the app's root `.env`).
   Otherwise `cp .env.example .env` and fill it in.
3. Install + run:

   ```bash
   cd bridge/pyannote
   python -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   set -a && . ./.env && set +a            # load .env into the environment
   uvicorn app:app --host 0.0.0.0 --port "${PORT:-8001}"
   ```

   Or with Docker:

   ```bash
   docker build -t gvoice-pyannote ./bridge/pyannote
   docker run --rm -p 8001:8001 --env-file bridge/pyannote/.env gvoice-pyannote
   ```

4. Verify it is up: `curl http://localhost:8001/health`.

## Wiring to the backend

In the Node backend root `.env`:

```
TRANSCRIPTION_PROVIDER=whisper
PYANNOTE_ENABLED=true
PYANNOTE_DIARIZATION_URL=http://localhost:8001/diarize
```

If the bridge is unreachable the Whisper provider degrades gracefully to a
single-speaker transcript rather than failing the meeting.
