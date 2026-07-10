# gVoice Pyannote diarization bridge (pyannote.ai cloud API wrapper).
# Build:  docker build -t gvoice-pyannote ./bridge/pyannote
# Run:    docker run --rm -p 8001:8001 --env-file bridge/pyannote/.env gvoice-pyannote
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./

ENV PORT=8001
EXPOSE 8001

CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8001}"]
