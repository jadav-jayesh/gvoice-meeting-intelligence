# Azure Whisper + Pyannote transcription provider

A second transcription provider that sits alongside the existing **Sarvam** flow.
Selected at runtime with `TRANSCRIPTION_PROVIDER`; both providers return the
exact same `TranscriptionResult`, so nothing downstream (normalize → speaker
mapping → resolver → summary → MoM → analytics) needs to know which one ran.

```
TRANSCRIPTION_PROVIDER=sarvam   → existing Sarvam flow (UNCHANGED)
TRANSCRIPTION_PROVIDER=whisper  → Azure Whisper + Pyannote pipeline (this doc)
TRANSCRIPTION_PROVIDER=auto     → legacy Azure/Sarvam auto-routing (UNCHANGED)
```

## Pipeline

```
speech.wav
  │
  ├─▶ Pyannote diarization (bridge/pyannote)         → SPEAKER_00 spans
  │
  ├─▶ Azure Whisper (verbose_json + word timestamps) → words[], language
  │      per-speaker-region decode: each contiguous same-speaker run is
  │      transcribed alone with auto-language, so a code-mixed meeting keeps
  │      every speaker's own language (a whole-file pass forces the whole
  │      meeting into the dominant speaker's language and breaks mapping).
  │
  ├─▶ Overlap-based merge                            → DiarizedTranscriptSegment[]
  │      every word is attributed to the diarization span that CONTAINS it
  │      (overlap, never nearest-timestamp), then grouped by speaker. clusterId
  │      = SPEAKER_xx, reused by the existing speakerMapper/resolver.
  │
  ├─▶ Language detection (script-based)              → en | hi | gu | mixed
  │
  ▼
TranscriptionResult { provider:"whisper", language, text, segments, raw }
  │
  ▼  (existing, provider-agnostic)
normalize → mapSpeakersToParticipants → SpeakerResolver → buildTranscriptText
  │
  ▼  (NEW, gated on TRANSCRIPTION_PROVIDER=whisper + non-English)
Translation layer → segments translated to English (originalText keeps native)
  │
  ▼
transcriptText (English for non-English meetings) → summary / action items / MoM
```

### Why translation runs in the orchestrator, after mapping

`transcriptText` is rebuilt from `segment.text` **after** speaker mapping and
resolution. Those steps match diarization clusters to participants partly via
caption text-overlap, which only works while the segment text is still in the
**native** language the captions are in. So translation is the *last* step:

1. transcribe + diarize + merge → native segments
2. normalize → map speakers → resolve  (all on native text)
3. **translate** resolved segments to English; keep native in `originalText`
4. rebuild `transcriptText`

The translation step is gated on `TRANSCRIPTION_PROVIDER === "whisper"`, so the
Sarvam flow never enters it and is byte-for-byte unchanged.

## Gujarati and the fallback provider

Azure Whisper **cannot** transcribe Gujarati (it returns empty or garbled
Devanagari). When the Whisper output is dominantly Indic script
(`indicScriptFraction ≥ WHISPER_INDIC_FALLBACK_THRESHOLD`), the audio is
re-transcribed by `TRANSCRIPTION_FALLBACK_PROVIDER` (Sarvam, `saaras:v3`
codemix), which handles it natively. The fallback also fires if the primary
throws. Because the meeting is still in **whisper mode**, the (now native and
correct) Gujarati transcript is then translated to English like any other
non-English meeting.

## Output contract

`TranscriptionResult` (unchanged shape, `provider` gained `"whisper"`):

| field      | meaning                                                        |
| ---------- | -------------------------------------------------------------- |
| `provider` | `"whisper"` (or `"sarvam"` if the Indic fallback fired)        |
| `language` | `en \| hi \| gu \| mixed`                                      |
| `text`     | full transcript (native)                                       |
| `segments` | `DiarizedTranscriptSegment[]` with `clusterId = SPEAKER_xx`    |

`DiarizedTranscriptSegment` gained two optional, additive fields:

- `originalText?` — native text, set only when `text` was translated to English.
- `language?` — per-segment detected language.

Both are optional, so legacy sessions and the Sarvam flow are unaffected and no
downstream consumer requires changes.

## Configuration

See `.env.example`. The essentials for whisper mode:

```
TRANSCRIPTION_PROVIDER=whisper
TRANSCRIPTION_FALLBACK_PROVIDER=sarvam
# Whisper reuses AZURE_OPENAI_* when WHISPER_* are blank
PYANNOTE_DIARIZATION_URL=http://127.0.0.1:8001/diarize
TRANSLATION_ENABLED=true
```

Start the diarization bridge first — see `bridge/pyannote/README.md`.

> **Operational note:** the worker caches `.env` at boot. After changing any of
> these values, **restart the worker**, or reprocess a finished session with
> `npm run session:reprocess -- <sessionId>` (runs current `src/`).

## Components

| File | Responsibility |
| ---- | -------------- |
| `src/transcription/whisper/azureWhisperTranscriber.ts` | Azure Whisper client; whole-file + per-region decode, chunking, Retry-After-aware retries |
| `src/transcription/pyannote/pyannoteDiarizationProvider.ts` | HTTP client for the local pyannote bridge |
| `src/transcription/merge/transcriptDiarizationMerger.ts` | Overlap-based word→speaker assignment + grouping |
| `src/transcription/languageDetection.ts` | Script-based language classification |
| `src/transcription/whisper/whisperProvider.ts` | Orchestrates the pipeline; implements `Transcriber` |
| `src/ai/translationService.ts` | Batched segment→English translation (STEP 6 glossary) |
| `src/transcription/transcriptionService.ts` | Provider selection + fallback routing |
| `bridge/pyannote/` | FastAPI diarization service |

## Tests

`npm test` (vitest). Coverage: overlap assignment/grouping, language detection,
pyannote parsing, Whisper verbose_json parsing + region building, translation
service (incl. failure fallback), and the Sarvam-safety translation gate.
