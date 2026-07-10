"""gVoice Pyannote diarization bridge (pyannote.ai cloud API).

A tiny FastAPI service that wraps the hosted pyannote.ai diarization API behind a
single synchronous HTTP endpoint, so the Node backend can diarize meeting audio
without speaking the cloud API's upload + async-job protocol itself.

The Whisper provider
(`src/transcription/pyannote/pyannoteDiarizationProvider.ts`) POSTs the meeting
WAV to `/diarize`; this service uploads it to pyannote.ai temporary storage,
starts a diarization job, polls until it finishes, and returns stable speaker
spans (SPEAKER_00 …).

Run:
    pip install -r requirements.txt
    cp .env.example .env   # already present in this repo; set PYANNOTE_API_KEY
    set -a && . ./.env && set +a
    uvicorn app:app --host 0.0.0.0 --port ${PORT:-8001}

Contract:
    POST /diarize  (multipart/form-data: file=<audio>)
      -> { "diarization": [{ "speaker": "SPEAKER_00", "start": 0.0, "end": 4.2 }, ...],
           "num_speakers": 2 }
    GET  /health   -> { "status": "ok", "base_url": "...", "configured": true }
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("pyannote-bridge")

BASE_URL = os.environ.get("PYANNOTE_BASE_URL", "https://api.pyannote.ai/v1").rstrip("/")
POLL_INTERVAL = float(os.environ.get("PYANNOTE_POLL_INTERVAL_SECONDS", "3"))
POLL_TIMEOUT = float(os.environ.get("PYANNOTE_POLL_TIMEOUT_SECONDS", "1200"))
HTTP_TIMEOUT = float(os.environ.get("PYANNOTE_HTTP_TIMEOUT_SECONDS", "120"))

app = FastAPI(title="gVoice Pyannote Bridge", version="1.0.0")


def resolve_api_key() -> str:
    key = os.environ.get("PYANNOTE_API_KEY") or os.environ.get("PYANNOTEAI_API_KEY")
    if not key:
        raise RuntimeError("PYANNOTE_API_KEY is not set. Get a key (sk_...) from https://dashboard.pyannote.ai")
    return key


@app.get("/health")
def health() -> dict:
    configured = bool(os.environ.get("PYANNOTE_API_KEY") or os.environ.get("PYANNOTEAI_API_KEY"))
    return {"status": "ok", "base_url": BASE_URL, "configured": configured}


@app.post("/diarize")
async def diarize(file: UploadFile = File(...)) -> dict:
    try:
        api_key = resolve_api_key()
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    headers = {"Authorization": f"Bearer {api_key}"}
    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=400, detail="empty audio upload")

    # A unique temporary object key in pyannote.ai's storage namespace.
    object_key = f"media://gvoice/{uuid.uuid4().hex}.wav"

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        # 1. Ask pyannote.ai for a pre-signed upload URL for this object key.
        presign = await client.post(f"{BASE_URL}/media/input", headers=headers, json={"url": object_key})
        _raise_for(presign, "request upload URL")
        put_url = presign.json().get("url")
        if not put_url:
            raise HTTPException(status_code=502, detail="pyannote media/input did not return an upload URL")

        # 2. Upload the audio bytes to the pre-signed URL (no auth header — it is
        #    a temporary signed URL).
        upload = await client.put(put_url, content=audio, headers={"Content-Type": "audio/wav"})
        _raise_for(upload, "upload audio")

        # 3. Start the diarization job.
        created = await client.post(f"{BASE_URL}/diarize", headers=headers, json={"url": object_key})
        _raise_for(created, "create diarization job")
        job_id = created.json().get("jobId") or created.json().get("job_id")
        if not job_id:
            raise HTTPException(status_code=502, detail="pyannote diarize did not return a jobId")

        # 4. Poll the job until it succeeds (or fails / times out).
        body = await _poll_job(client, headers, job_id)

    spans = _extract_diarization(body)
    num_speakers = len({span["speaker"] for span in spans})
    logger.info("diarized %s spans across %s speakers (job %s)", len(spans), num_speakers, job_id)
    return {"diarization": spans, "num_speakers": num_speakers}


async def _poll_job(client: httpx.AsyncClient, headers: dict, job_id: str) -> dict:
    waited = 0.0
    while waited < POLL_TIMEOUT:
        response = await client.get(f"{BASE_URL}/jobs/{job_id}", headers=headers)
        _raise_for(response, "poll job")
        body = response.json()
        status = (body.get("status") or "").lower()
        if status in ("succeeded", "success", "completed", "done"):
            return body
        if status in ("failed", "canceled", "cancelled", "error"):
            raise HTTPException(status_code=502, detail=f"pyannote job {status}: {body.get('error') or body}")
        await asyncio.sleep(POLL_INTERVAL)
        waited += POLL_INTERVAL
    raise HTTPException(status_code=504, detail=f"pyannote job {job_id} timed out after {POLL_TIMEOUT}s")


def _extract_diarization(body: dict) -> list[dict]:
    output = body.get("output") or body
    raw = output.get("diarization") or output.get("segments") or []
    spans = []
    for item in raw:
        start = item.get("start", item.get("start_time"))
        end = item.get("end", item.get("end_time"))
        speaker = item.get("speaker", item.get("label"))
        if start is None or end is None or float(end) <= float(start):
            continue
        spans.append({"speaker": str(speaker), "start": round(float(start), 3), "end": round(float(end), 3)})
    spans.sort(key=lambda span: (span["start"], span["end"]))
    return spans


def _raise_for(response: httpx.Response, action: str) -> None:
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"pyannote.ai failed to {action} ({response.status_code}): {response.text[:300]}")
