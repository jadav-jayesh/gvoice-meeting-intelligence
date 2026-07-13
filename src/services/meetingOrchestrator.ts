import { env } from "../config/env";
import { cfgNumber, hydrateRuntimeConfig } from "../config/runtimeConfig";
import { BotSessionModel } from "../models/BotSession";
import { createMeetingBot } from "../bots/botFactory";
import { CaptionTracker } from "../capture/captionTracker";
import {
  ParticipantTracker,
  buildCaptionSpeakerTimeline,
  dedupeParticipants,
  mergeParticipantTimelines,
  mergeParticipants,
  validatedCaptionSpeakers,
  cleanParticipantName
} from "../processing/participants";
import { hasSpeechCaptionEvidence } from "../processing/captions";
import { buildCaptionDerivedTranscript } from "../processing/captionTranscript";
import { normalizeDiarizedTranscript } from "../processing/diarization";
import { assessWhisperReliability } from "../processing/transcriptQuality";
import { mapSpeakersToParticipants } from "../processing/speakerMapper";
import { reconcileTeamsSegments, estimateClockOffset } from "../processing/teamsSpeakerRemap";
import { buildTranscriptText } from "../processing/transcriptText";
import { validateCompletion } from "../processing/validation";
import { MeetingRecorder } from "../media/recorder";
import { analyzeSpeech, extractVideoThumbnail } from "../media/ffmpeg";
import { loadPerSessionSink, unloadSink, type PerSessionSink } from "../media/pulseSink";
import {
  cleanupSessionBrowserProfile,
  createSessionBrowserProfile,
  createSessionMediaPaths
} from "../utils/files";
import { delay } from "../utils/async";
import { secondsBetween } from "../utils/time";
import { TranscriptionService, shouldTranslateToEnglish } from "../transcription/transcriptionService";
import { TranslationService } from "../ai/translationService";
import { resolveMeetingName } from "./meetingTitle";
import { SummaryService } from "../ai/summaryService";
import { MomReportService } from "../ai/momReportService";
import { SpeakerResolverService } from "../ai/speakerResolverService";
import { AzureBlobStorage } from "../storage/azureBlobStorage";
import { appendMeetingLog } from "./meetingLogService";
import { MicrosoftTeamsSdkService, type TeamsSdkTranscriptResult, type TeamsTranscriptPendingResult } from "./microsoftTeamsSdkService";
import { ZoomCloudRecordingService, isPermanentZoomError, type ZoomCloudTranscriptResult } from "./zoomCloudRecordingService";
import { WebhookService } from "./webhookService";
import { enqueueTeamsTranscriptRetry } from "../queue/botQueue";
import { logger as rootLogger } from "../utils/logger";
import type { BotSession, BotSessionDocument } from "../models/BotSession";
import type { SessionMediaPaths } from "../types/media";
import type { BotStatus, DiarizedTranscriptSegment, MeetingIntelligenceResult, Participant } from "../types/meeting";

export class MeetingOrchestrator {
  async run(sessionId: string): Promise<void> {
    // Pick up any admin Settings changes since this process started (covers a
    // separate worker process; in-process worker is already current).
    await hydrateRuntimeConfig();

    const session = await BotSessionModel.findOne({ sessionId });
    if (!session) throw new Error(`Bot session not found: ${sessionId}`);

    const logger = rootLogger.child({ sessionId, platform: session.platform });
    const paths = await createSessionMediaPaths(sessionId);
    if (session.platform === "microsoft_teams" && env.TEAMS_MODE === "graph_transcript") {
      await this.runMicrosoftTeamsSdkFlow(session, logger, paths);
      return;
    }

    const bot = createMeetingBot(session.platform, logger);
    const participantTracker = new ParticipantTracker();
    const captionTracker = new CaptionTracker();

    let joinedAt: Date | undefined;
    let endedAt = new Date();
    let mediaDuration = 0;
    let captureCancelled = false;
    let capturePromise: Promise<void> | undefined;
    let sessionProfileDir: string | undefined;
    let perSessionSink: PerSessionSink | undefined;

    try {
      await this.updateStatus(session, "starting");

      // Per-session isolation so N concurrent bot sessions can run on one host
      // without colliding on Chromium's SingletonLock or the default PulseAudio
      // monitor source. Both fall back gracefully (cloning skipped when flag is
      // off; sink load returns undefined and the recorder uses the env source).
      const sessionSetup = await this.prepareSessionIsolation(session, sessionId);
      sessionProfileDir = sessionSetup.sessionProfileDir;
      perSessionSink = sessionSetup.perSessionSink;

      const recorder = new MeetingRecorder(paths, perSessionSink?.monitorSource);

      await this.appendLog(session, {
        phase: "browser",
        event: "browser_launch_started",
        message: "Launching meeting browser",
        status: "starting",
        metadata: { videoDir: paths.videoDir, sessionProfileDir, pulseSink: perSessionSink?.sinkName }
      });
      await bot.launch({
        recordVideoDir: paths.videoDir,
        userDataDir: sessionProfileDir,
        pulseSink: perSessionSink?.sinkName
      });
      // Playwright begins recording browser video the moment the persistent
      // context is up. We need this timestamp so the merger can trim the
      // waiting-room footage out of the final MP4.
      const browserStartedAt = new Date();
      await this.appendLog(session, {
        phase: "browser",
        event: "browser_launched",
        message: "Meeting browser launched",
        status: "starting",
        metadata: { browserStartedAt: browserStartedAt.toISOString() }
      });

      await this.updateStatus(session, "joining");
      await this.appendLog(session, {
        phase: "join",
        event: "join_started",
        message: "Joining meeting",
        status: "joining",
        metadata: { platform: session.platform }
      });
      joinedAt = await bot.join(session.meetingUrl, { meetingPasscode: session.meetingPasscode });
      // Audio recording starts only after admission so the audio file contains
      // no pre-join content at all. The Playwright video does include pre-join
      // (it's tied to the browser context), but the merge step trims it so the
      // final MP4 begins at admission.
      await recorder.start();
      capturePromise = this.captureMeeting(
        session,
        bot,
        participantTracker,
        captionTracker,
        logger,
        () => joinedAt,
        () => captureCancelled
      );
      await this.update(session, { status: "recording", startedAt: joinedAt });
      await this.appendLog(session, {
        phase: "recording",
        event: "recording_started",
        message: "Audio recording started after admission",
        status: "recording",
        metadata: { joinedAt: joinedAt.toISOString() }
      });

      // Read the in-page meeting name as soon as we are admitted. The page is
      // alive from here until bot.close() and the title is usually populated
      // by the time the leave control is visible. Hybrid providers below may
      // override this with a higher-quality source (Graph subject / Zoom
      // topic) when available.
      // Don't let the in-page title overwrite a calendar-provided title — that
      // scheduled title is the authoritative human name.
      const initialMeetingName = await bot.getMeetingName().catch(() => undefined);
      if (initialMeetingName && !session.scheduledMeetingTitle?.trim()) {
        await this.update(session, { meetingName: initialMeetingName });
        await this.appendLog(session, {
          phase: "join",
          event: "meeting_name_captured",
          message: "Meeting name captured from in-page title",
          status: "recording",
          metadata: { meetingName: initialMeetingName, source: "page_title" }
        });
      }
      await this.appendLog(session, {
        phase: "join",
        event: "join_completed",
        message: "Bot joined meeting and recording is active",
        status: "recording",
        metadata: { joinedAt: joinedAt.toISOString() }
      });

      await capturePromise;
      endedAt = new Date();
      await this.appendLog(session, {
        phase: "capture",
        event: "live_capture_completed",
        message: "Live meeting capture loop completed",
        status: "recording",
        metadata: {
          captionCount: captionTracker.values().length,
          participantCount: participantTracker.getParticipants().length,
          endedAt: endedAt.toISOString()
        }
      });

      await this.updateStatus(session, "uploading");
      await this.appendLog(session, {
        phase: "recording",
        event: "recording_stop_started",
        message: "Stopping and finalizing meeting recording",
        status: "uploading"
      });
      const media = await recorder.stop({
        joinedAt,
        browserStartedAt,
        finalizeVideo: () => bot.close()
      });
      mediaDuration = media.durationSeconds;
      await this.appendLog(session, {
        phase: "recording",
        event: "recording_finalized",
        message: "Meeting recording finalized",
        status: "uploading",
        metadata: {
          durationSeconds: media.durationSeconds,
          finalRecordingPath: media.finalRecordingPath,
          hasExtractedAudio: Boolean(media.extractedAudioPath)
        }
      });

      const storage = new AzureBlobStorage();
      await this.appendLog(session, {
        phase: "upload",
        event: "recording_upload_started",
        message: "Uploading meeting recording",
        status: "uploading"
      });
      const recordingUpload = await storage.uploadFile(media.finalRecordingPath, storage.recordingBlobName(sessionId), "video/mp4");
      logger.info({ recordingUrl: recordingUpload.url }, "recording uploaded");
      await this.appendLog(session, {
        phase: "upload",
        event: "recording_uploaded",
        message: "Meeting recording uploaded",
        status: "uploading",
        metadata: { blobName: recordingUpload.blobName, recordingUrl: recordingUpload.url }
      });

      // Best-effort: grab a frame from the recording and upload it as the
      // meeting's list thumbnail. We sample a few seconds in so the frame is
      // not a black pre-roll; failures are non-fatal (the list falls back to
      // the platform badge when thumbnailUrl is missing).
      let thumbnailUrl: string | undefined;
      const thumbnailSampleAt = Math.min(
        Math.max(2, (media.durationSeconds || 0) * 0.1),
        Math.max(1, (media.durationSeconds || 0) - 1)
      );
      const thumbnailWritten = await extractVideoThumbnail(
        media.finalRecordingPath,
        paths.thumbnailPath,
        { atSeconds: thumbnailSampleAt }
      );
      if (thumbnailWritten) {
        try {
          const thumbnailUpload = await storage.uploadFile(
            paths.thumbnailPath,
            storage.thumbnailBlobName(sessionId),
            "image/jpeg"
          );
          thumbnailUrl = thumbnailUpload.url;
          await this.appendLog(session, {
            phase: "upload",
            event: "thumbnail_uploaded",
            message: "Meeting thumbnail uploaded",
            status: "uploading",
            metadata: {
              blobName: thumbnailUpload.blobName,
              thumbnailUrl: thumbnailUpload.url,
              sampledAtSeconds: thumbnailSampleAt
            }
          });
        } catch (error) {
          await this.appendLog(session, {
            level: "warn",
            phase: "upload",
            event: "thumbnail_upload_failed",
            message: "Thumbnail upload failed; continuing without thumbnail",
            status: "uploading",
            metadata: { error: error instanceof Error ? error.message : String(error) }
          });
        }
      } else {
        await this.appendLog(session, {
          level: "warn",
          phase: "upload",
          event: "thumbnail_extraction_failed",
          message: "Thumbnail extraction returned no frame; continuing without thumbnail",
          status: "uploading"
        });
      }

      await this.update(session, {
        recordingUrl: recordingUpload.url,
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
        status: "processing"
      });
      await this.appendLog(session, {
        phase: "processing",
        event: "post_meeting_processing_started",
        message: "Post-meeting processing started",
        status: "processing"
      });

      let captions = captionTracker.values();
      const captionSpeechExists = hasSpeechCaptionEvidence(captions);
      const panelParticipants = participantTracker.getParticipants();
      const requireParticipantPanelRoster = session.platform === "microsoft_teams";
      let participants = requireParticipantPanelRoster ? panelParticipants : mergeParticipants(panelParticipants, validatedCaptionSpeakers(captions));

      let speechExists = false;
      let diarizedTranscript: DiarizedTranscriptSegment[] = [];
      let transcriptText = "";
      let participantsTimelineOverride: ReturnType<typeof mergeParticipantTimelines> | undefined;
      let transcriptSource = "recorded_audio";
      let graphTranscriptAvailable = false;
      let graphParticipants: Participant[] = [];
      let graphCaptions: typeof captions = [];
      let graphDiarizedTranscript: DiarizedTranscriptSegment[] = [];
      let graphTranscriptText = "";
      let graphParticipantsTimeline: ReturnType<typeof mergeParticipantTimelines> | undefined;
      let teamsTranscriptMetadata:
        | {
            onlineMeetingId: string;
            transcriptId: string;
            subject?: string;
            transcriptCreatedAt?: string;
            transcriptEndedAt?: string;
            rawVtt?: string;
          }
        | undefined;

      if (session.platform === "microsoft_teams" && env.TEAMS_MODE === "hybrid") {
        await this.appendLog(session, {
          phase: "transcription",
          event: "teams_hybrid_graph_transcript_started",
          message: "Checking Microsoft Graph transcript before recorded-audio fallback",
          status: "processing",
          metadata: {
            pollIntervalMs: env.TEAMS_GRAPH_TRANSCRIPT_POLL_INTERVAL_MS,
            timeoutMs: env.TEAMS_GRAPH_TRANSCRIPT_TIMEOUT_MS
          }
        });

        try {
          const collection = await new MicrosoftTeamsSdkService(logger).collectTranscript(session.meetingUrl);
          if (collection.status === "ready" && isTeamsTranscriptInSessionWindow(collection.result, joinedAt, endedAt)) {
            const teamsResult = collection.result;
            graphTranscriptAvailable = true;
            graphParticipants = teamsResult.participants;
            graphCaptions = teamsResult.captionsTimeline;
            graphDiarizedTranscript = teamsResult.diarizedTranscript;
            graphTranscriptText = teamsResult.transcriptText;
            graphParticipantsTimeline = teamsResult.participantsTimeline;
            if (!requireParticipantPanelRoster) {
              participants = mergeParticipants(participants, graphParticipants);
            }
            teamsTranscriptMetadata = {
              onlineMeetingId: teamsResult.meeting.id,
              transcriptId: teamsResult.transcript.id,
              subject: teamsResult.meeting.subject,
              transcriptCreatedAt: teamsResult.transcript.createdDateTime,
              transcriptEndedAt: teamsResult.transcript.endDateTime,
              rawVtt: teamsResult.rawVtt
            };
            await this.update(session, {
              teamsOnlineMeetingId: teamsResult.meeting.id,
              teamsTranscriptId: teamsResult.transcript.id,
              ...(teamsResult.meeting.subject ? { meetingName: teamsResult.meeting.subject } : {}),
              transcriptPolling: {
                onlineMeetingId: teamsResult.meeting.id,
                transcriptId: teamsResult.transcript.id,
                retryCount: 0,
                pollAttemptCount: 0,
                lastPollAt: new Date()
              }
            });
            await this.appendLog(session, {
              phase: "transcription",
              event: "teams_hybrid_graph_transcript_hints_ready",
              message: "Microsoft Graph transcript is available for hybrid speaker and participant hints",
              status: "processing",
              metadata: {
                onlineMeetingId: teamsResult.meeting.id,
                transcriptId: teamsResult.transcript.id,
                participantCount: teamsResult.participants.length,
                segmentCount: teamsResult.diarizedTranscript.length,
                transcriptTextLength: teamsResult.transcriptText.length
              }
            });
          } else {
            if (collection.status === "ready") {
              await this.appendLog(session, {
                level: "warn",
                phase: "transcription",
                event: "teams_hybrid_graph_transcript_stale",
                message: "Microsoft Graph transcript does not overlap this bot session; using recorded-audio fallback",
                status: "processing",
                metadata: {
                  onlineMeetingId: collection.result.meeting.id,
                  transcriptId: collection.result.transcript.id,
                  meetingStart: collection.result.startedAt,
                  meetingEnd: collection.result.endedAt,
                  sessionJoinedAt: joinedAt,
                  sessionEndedAt: endedAt
                }
              });
            }
            const pending = collection.status === "pending" ? collection.pending : undefined;
            await this.appendLog(session, {
              level: "warn",
              phase: "transcription",
              event: "teams_hybrid_graph_transcript_pending",
              message: pending
                ? "Microsoft Graph transcript is pending; using recorded-audio fallback"
                : "Microsoft Graph transcript was not usable for this session; using recorded-audio fallback",
              status: "processing",
              metadata: pending
                ? {
                    onlineMeetingId: pending.meeting.id,
                    attempts: pending.attempts,
                    pendingDurationMs: pending.pendingDurationMs,
                    transcript_found: false
                  }
                : { transcript_found: false, reason: "stale_graph_transcript" }
            });
            if (pending) {
              await this.update(session, {
                teamsOnlineMeetingId: pending.meeting.id,
                transcriptPolling: {
                  onlineMeetingId: pending.meeting.id,
                  retryCount: 0,
                  pollAttemptCount: pending.attempts,
                  firstPollAt: pending.firstPollAt,
                  lastPollAt: pending.lastPollAt,
                  pendingDurationMs: pending.pendingDurationMs,
                  lastGraphStatus: 200
                }
              });
            }
          }
        } catch (error) {
          await this.appendLog(session, {
            level: "warn",
            phase: "transcription",
            event: "teams_hybrid_graph_transcript_unavailable",
            message: "Microsoft Graph transcript check failed; using recorded-audio fallback",
            status: "processing",
            metadata: {
              permanentGraphError: isPermanentTeamsGraphError(error),
              error: error instanceof Error ? error.message : String(error)
            }
          });
        }
      }

      // Zoom hybrid mirrors the Teams hybrid pattern: try the Zoom Cloud
      // Recording transcript first as a speaker-hint source; if it's not
      // ready/available, fall through to the recorded-audio path. The same
      // "graph*" variables below are reused — they semantically represent
      // "external SDK transcript hints" regardless of platform.
      let sdkTranscriptSource: "microsoft_graph_sdk" | "zoom_cloud_recording" | undefined =
        graphTranscriptAvailable ? "microsoft_graph_sdk" : undefined;
      let zoomTranscriptMetadata:
        | {
            meetingId: string;
            recordingId?: string;
            transcriptFileId?: string;
            topic?: string;
            transcriptStart?: string;
            transcriptEnd?: string;
            rawVtt?: string;
          }
        | undefined;

      if (session.platform === "zoom" && env.ZOOM_MODE === "hybrid") {
        await this.appendLog(session, {
          phase: "transcription",
          event: "zoom_hybrid_cloud_transcript_started",
          message: "Checking Zoom Cloud Recording transcript before recorded-audio fallback",
          status: "processing",
          metadata: {
            pollIntervalMs: env.ZOOM_TRANSCRIPT_POLL_INTERVAL_MS,
            timeoutMs: env.ZOOM_TRANSCRIPT_TIMEOUT_MS
          }
        });

        try {
          const collection = await new ZoomCloudRecordingService(logger).collectTranscript(session.meetingUrl);
          if (collection.status === "ready" && isZoomTranscriptInSessionWindow(collection.result, joinedAt, endedAt)) {
            const zoomResult = collection.result;
            graphTranscriptAvailable = true;
            sdkTranscriptSource = "zoom_cloud_recording";
            graphParticipants = zoomResult.participants;
            graphCaptions = zoomResult.captionsTimeline;
            graphDiarizedTranscript = zoomResult.diarizedTranscript;
            graphTranscriptText = zoomResult.transcriptText;
            graphParticipantsTimeline = zoomResult.participantsTimeline;
            if (!requireParticipantPanelRoster) {
              participants = mergeParticipants(participants, graphParticipants);
            }
            zoomTranscriptMetadata = {
              meetingId: String(zoomResult.meeting.id),
              recordingId: zoomResult.recording.id,
              transcriptFileId: zoomResult.transcriptFile.id,
              topic: zoomResult.meeting.topic ?? zoomResult.recording.topic,
              transcriptStart: zoomResult.transcriptFile.recording_start,
              transcriptEnd: zoomResult.transcriptFile.recording_end,
              rawVtt: zoomResult.rawVtt
            };
            await this.update(session, {
              zoomMeetingId: zoomTranscriptMetadata.meetingId,
              zoomRecordingId: zoomTranscriptMetadata.recordingId,
              zoomTranscriptFileId: zoomTranscriptMetadata.transcriptFileId,
              ...(zoomTranscriptMetadata.topic ? { meetingName: zoomTranscriptMetadata.topic } : {}),
              transcriptPolling: {
                onlineMeetingId: zoomTranscriptMetadata.meetingId,
                transcriptId: zoomTranscriptMetadata.transcriptFileId,
                retryCount: 0,
                pollAttemptCount: 0,
                lastPollAt: new Date()
              }
            });
            await this.appendLog(session, {
              phase: "transcription",
              event: "zoom_hybrid_cloud_transcript_hints_ready",
              message: "Zoom Cloud Recording transcript is available for hybrid speaker and participant hints",
              status: "processing",
              metadata: {
                meetingId: zoomTranscriptMetadata.meetingId,
                transcriptFileId: zoomTranscriptMetadata.transcriptFileId,
                participantCount: zoomResult.participants.length,
                segmentCount: zoomResult.diarizedTranscript.length,
                transcriptTextLength: zoomResult.transcriptText.length
              }
            });
          } else {
            if (collection.status === "ready") {
              await this.appendLog(session, {
                level: "warn",
                phase: "transcription",
                event: "zoom_hybrid_cloud_transcript_stale",
                message: "Zoom Cloud Recording transcript does not overlap this bot session; using recorded-audio fallback",
                status: "processing",
                metadata: {
                  meetingId: String(collection.result.meeting.id),
                  transcriptFileId: collection.result.transcriptFile.id,
                  meetingStart: collection.result.startedAt,
                  meetingEnd: collection.result.endedAt,
                  sessionJoinedAt: joinedAt,
                  sessionEndedAt: endedAt
                }
              });
            }
            const pending = collection.status === "pending" ? collection.pending : undefined;
            await this.appendLog(session, {
              level: "warn",
              phase: "transcription",
              event: "zoom_hybrid_cloud_transcript_pending",
              message: pending
                ? "Zoom Cloud Recording transcript is pending; using recorded-audio fallback"
                : "Zoom Cloud Recording transcript was not usable for this session; using recorded-audio fallback",
              status: "processing",
              metadata: pending
                ? {
                    meetingId: String(pending.meeting.id),
                    attempts: pending.attempts,
                    pendingDurationMs: pending.pendingDurationMs,
                    transcript_found: false
                  }
                : { transcript_found: false, reason: "stale_zoom_transcript" }
            });
            if (pending) {
              await this.update(session, {
                zoomMeetingId: String(pending.meeting.id),
                transcriptPolling: {
                  onlineMeetingId: String(pending.meeting.id),
                  retryCount: 0,
                  pollAttemptCount: pending.attempts,
                  firstPollAt: pending.firstPollAt,
                  lastPollAt: pending.lastPollAt,
                  pendingDurationMs: pending.pendingDurationMs,
                  lastGraphStatus: 200
                }
              });
            }
          }
        } catch (error) {
          await this.appendLog(session, {
            level: "warn",
            phase: "transcription",
            event: "zoom_hybrid_cloud_transcript_unavailable",
            message: "Zoom Cloud Recording transcript check failed; using recorded-audio fallback",
            status: "processing",
            metadata: {
              permanentZoomError: isPermanentZoomError(error),
              error: error instanceof Error ? error.message : String(error)
            }
          });
        }
      }

      const speakerHintCaptions = graphTranscriptAvailable ? mergeCaptionTimelines(captions, graphCaptions) : captions;

      if (media.extractedAudioPath) {
        await this.appendLog(session, {
          phase: "processing",
          event: "speech_analysis_started",
          message: "Analyzing extracted audio for speech",
          status: "processing",
          metadata: { audioPath: media.extractedAudioPath }
        });
        const speech = await analyzeSpeech(media.extractedAudioPath);
        speechExists = speech.hasSpeech || captionSpeechExists;
        logger.info({ speech, captionSpeechExists }, "speech analysis complete");
        await this.appendLog(session, {
          phase: "processing",
          event: "speech_analysis_completed",
          message: "Speech analysis completed",
          status: "processing",
          metadata: { speech, captionSpeechExists, speechExists }
        });

        if (speechExists) {
          try {
            await this.appendLog(session, {
              phase: "transcription",
              event: "transcription_started",
              message: "Transcription started",
              status: "processing"
            });
            const transcription = await new TranscriptionService(logger).transcribe(media.extractedAudioPath);
            logger.info(
              { provider: transcription.provider, language: transcription.language, segmentCount: transcription.segments.length },
              "transcription complete"
            );
            await this.appendLog(session, {
              phase: "transcription",
              event: "transcription_completed",
              message: "Transcription completed",
              status: "processing",
              metadata: {
                provider: transcription.provider,
                language: transcription.language,
                segmentCount: transcription.segments.length
              }
            });
            // Surface which engine produced the transcript and the detected
            // meeting language on the session, so the UI can show them per
            // meeting (e.g. "whisper · en"). The Sarvam-fallback reroute is
            // reflected here too (provider becomes "sarvam").
            session.transcriptionProvider = transcription.provider;
            session.meetingLanguage = transcription.language;

            const normalized = normalizeDiarizedTranscript(transcription.segments);
            if (!requireParticipantPanelRoster) {
              participants = mergeParticipants(participants, validatedDiarizationParticipants(normalized));
            }
            const speakerResolutionParticipants = requireParticipantPanelRoster
              ? mergeParticipants(participants, validatedCaptionSpeakers(speakerHintCaptions))
              : participants;
            diarizedTranscript = mapSpeakersToParticipants(
              normalized,
              speakerResolutionParticipants,
              speakerHintCaptions,
              logger,
              joinedAt,
              participantTracker.getTimeline(endedAt)
            );
            await this.appendLog(session, {
              phase: "transcription",
              event: "speaker_mapping_completed",
              message: "Speaker mapping completed",
              status: "processing",
              metadata: {
                participantCount: participants.length,
                speakerResolutionParticipantCount: speakerResolutionParticipants.length,
                normalizedSegmentCount: normalized.length,
                mappedSegmentCount: diarizedTranscript.length
              }
            });
            diarizedTranscript = await new SpeakerResolverService(logger).resolve({
              participants: speakerResolutionParticipants,
              diarizedTranscript: normalized,
              captionsTimeline: speakerHintCaptions,
              currentTranscript: diarizedTranscript,
              meetingStartedAt: joinedAt
            });
            transcriptText = buildTranscriptText(diarizedTranscript);

            // Adopt the external SDK transcript wholesale when available. The
            // Teams Graph / Zoom transcript labels every line with the EXACT
            // speaker AND splits overlapping/rapid turns per speaker — audio
            // diarisation instead merges those into one block and mis-names it.
            // So we replace the audio-derived segments with the SDK transcript
            // (reconciling its speaker names to the participant roster); its
            // text + segmentation are the ground truth. Only runs when such a
            // transcript is present, so audio-only meetings are unaffected.
            // NOTE: Teams caption text is English-biased — a future language
            // gate can keep the audio (Sarvam) text for Gujarati/Hindi meetings.
            if (graphTranscriptAvailable && graphDiarizedTranscript.length > 0) {
              const audioSegmentCount = diarizedTranscript.length;
              // `participants` is already deduped upstream (mergeParticipants →
              // dedupeParticipants collapses "Taaif Dadan" onto "Taaif" via
              // cleanParticipantName), so reconciled labels stay consistent.
              // The SDK transcript runs on the meeting clock; the recorded audio
              // (and the video the UI plays) starts when the bot joined. Align
              // the SDK timestamps to the recording clock so the transcript
              // highlights the correct line during playback.
              const clockOffsetSeconds = estimateClockOffset(
                diarizedTranscript.map((segment) => segment.startTime),
                graphDiarizedTranscript.map((segment) => ({ speaker: segment.speaker, start: segment.startTime, end: segment.endTime }))
              );
              diarizedTranscript = reconcileTeamsSegments(
                graphDiarizedTranscript,
                participants.map((participant) => participant.name).filter(Boolean),
                clockOffsetSeconds
              );
              transcriptText = buildTranscriptText(diarizedTranscript);
              await this.appendLog(session, {
                phase: "transcription",
                event: "sdk_transcript_adopted",
                message: "Adopted the external SDK transcript for correct speaker splitting",
                status: "processing",
                metadata: {
                  source: sdkTranscriptSource,
                  audioSegmentCount,
                  sdkSegmentCount: diarizedTranscript.length,
                  clockOffsetSeconds: Math.round(clockOffsetSeconds)
                }
              });
            }

            await this.appendLog(session, {
              phase: "transcription",
              event: "speaker_resolution_completed",
              message: "Speaker resolution completed",
              status: "processing",
              metadata: {
                resolvedSegmentCount: diarizedTranscript.length,
                transcriptTextLength: transcriptText.length
              }
            });

            // Translation layer (Whisper provider only). For non-English
            // meetings the final transcriptText must be English. We translate
            // AFTER speaker mapping/resolution so caption text-overlap matching
            // still ran against the native transcript; the native text is kept
            // per segment in `originalText`. The Sarvam flow never reaches here
            // (gated on TRANSCRIPTION_PROVIDER=whisper), so it is unaffected.
            if (diarizedTranscript.length > 0 && shouldTranslateToEnglish(transcription)) {
              try {
                diarizedTranscript = await new TranslationService(logger).translateSegments(diarizedTranscript, {
                  sourceLanguage: transcription.language
                });
                transcriptText = buildTranscriptText(diarizedTranscript);
                await this.appendLog(session, {
                  phase: "transcription",
                  event: "translation_completed",
                  message: "Transcript translated to English",
                  status: "processing",
                  metadata: {
                    sourceLanguage: transcription.language,
                    translatedSegmentCount: diarizedTranscript.filter((segment) => segment.originalText !== undefined).length,
                    transcriptTextLength: transcriptText.length
                  }
                });
              } catch (error) {
                logger.warn({ err: error }, "transcript translation failed; keeping original-language transcript");
                await this.appendLog(session, {
                  level: "warn",
                  phase: "transcription",
                  event: "translation_failed",
                  message: "Transcript translation failed; original-language transcript kept",
                  status: "processing",
                  metadata: { error: error instanceof Error ? error.message : String(error) }
                });
              }
            }

            // Caption fallback fires when the provider returned no speech at
            // all, OR (whisper only) when its output is garbage: Azure Whisper
            // cannot decode some audio (notably Gujarati) and instead of
            // returning empty it hallucinates a few tiny identical segments on
            // noise while missing the real speech. The reliability check
            // catches that shape; the (untouched) Sarvam flow is never gated.
            const whisperQuality =
              transcription.provider === "whisper" && diarizedTranscript.length > 0 && captionSpeechExists
                ? assessWhisperReliability(diarizedTranscript, captions, speech.speechSeconds)
                : undefined;
            if ((diarizedTranscript.length === 0 || whisperQuality?.unreliable) && captionSpeechExists) {
              const fallbackReason = whisperQuality?.unreliable ? whisperQuality.reason : "no_speech";
              diarizedTranscript = buildCaptionDerivedTranscript(captions, { meetingStartedAt: joinedAt });
              transcriptText = buildTranscriptText(diarizedTranscript);
              if (!requireParticipantPanelRoster) {
                participants = mergeParticipants(participants, validatedCaptionSpeakers(captions));
              }
              logger.warn(
                { captionSegmentCount: diarizedTranscript.length, provider: transcription.provider, fallbackReason, whisperQuality },
                "provider transcription unusable; using caption-derived transcript fallback"
              );
              await this.appendLog(session, {
                level: "warn",
                phase: "transcription",
                event: "caption_transcript_fallback_used",
                message:
                  fallbackReason === "no_speech"
                    ? "Provider returned no speech; caption-derived transcript was used"
                    : "Provider transcript was unreliable (hallucinated/sparse); caption-derived transcript was used",
                status: "processing",
                metadata: {
                  captionSegmentCount: diarizedTranscript.length,
                  provider: transcription.provider,
                  fallbackReason,
                  qualityMetrics: whisperQuality?.metrics
                }
              });
            }
          } catch (error) {
            // Always-succeed policy: transcription failure never fails the
            // meeting. If we have caption evidence, degrade to the caption-derived
            // transcript; otherwise (non-English meetings often have no usable
            // captions) complete with an empty transcript rather than throwing.
            diarizedTranscript = captionSpeechExists
              ? buildCaptionDerivedTranscript(captions, { meetingStartedAt: joinedAt })
              : [];
            transcriptText = buildTranscriptText(diarizedTranscript);
            if (captionSpeechExists && !requireParticipantPanelRoster) {
              participants = mergeParticipants(participants, validatedCaptionSpeakers(captions));
            }
            logger.warn(
              { err: error, captionSegmentCount: diarizedTranscript.length, captionSpeechExists },
              captionSpeechExists
                ? "provider transcription failed; using caption-derived transcript fallback"
                : "provider transcription failed and no captions available; completing with empty transcript"
            );
            await this.appendLog(session, {
              level: "warn",
              phase: "transcription",
              event: "caption_transcript_fallback_used",
              message: captionSpeechExists
                ? "Transcription failed; caption-derived transcript was used"
                : "Transcription failed and no captions were available; meeting completed with an empty transcript",
              status: "processing",
              metadata: {
                captionSegmentCount: diarizedTranscript.length,
                captionSpeechExists,
                error: error instanceof Error ? error.message : String(error)
              }
            });
          }
        }
      } else if (!transcriptText) {
        speechExists = captionSpeechExists;
        logger.warn({ captionSpeechExists }, "no extracted audio path available for transcription");
        await this.appendLog(session, {
          level: "warn",
          phase: "transcription",
          event: "audio_missing",
          message: "No extracted audio was available for transcription",
          status: "processing",
          metadata: { captionSpeechExists }
        });
        if (captionSpeechExists) {
          diarizedTranscript = buildCaptionDerivedTranscript(captions, { meetingStartedAt: joinedAt });
          transcriptText = buildTranscriptText(diarizedTranscript);
          if (!requireParticipantPanelRoster) {
            participants = mergeParticipants(participants, validatedCaptionSpeakers(captions));
          }
          logger.warn({ captionSegmentCount: diarizedTranscript.length }, "using caption-derived transcript fallback without extracted audio");
          await this.appendLog(session, {
            level: "warn",
            phase: "transcription",
            event: "caption_transcript_fallback_used",
            message: "Caption-derived transcript was used without extracted audio",
            status: "processing",
            metadata: { captionSegmentCount: diarizedTranscript.length }
          });
        }
      }

      if (!transcriptText && graphTranscriptAvailable) {
        transcriptSource = sdkTranscriptSource ?? "microsoft_graph_sdk";
        speechExists = true;
        if (!requireParticipantPanelRoster) {
          participants = mergeParticipants(participants, graphParticipants);
        }
        if (!requireParticipantPanelRoster) {
          participantsTimelineOverride = graphParticipantsTimeline;
        }
        captions = graphCaptions;
        diarizedTranscript = graphDiarizedTranscript;
        transcriptText = graphTranscriptText;
        const fallbackEvent =
          sdkTranscriptSource === "zoom_cloud_recording"
            ? "zoom_hybrid_cloud_transcript_fallback_used"
            : "teams_hybrid_graph_transcript_fallback_used";
        const fallbackMessage =
          sdkTranscriptSource === "zoom_cloud_recording"
            ? "Recorded-audio transcript was unavailable; using Zoom Cloud Recording transcript as final fallback"
            : "Recorded-audio transcript was unavailable; using Microsoft Graph transcript as final fallback";
        await this.appendLog(session, {
          level: "warn",
          phase: "transcription",
          event: fallbackEvent,
          message: fallbackMessage,
          status: "processing",
          metadata: {
            participantCount: graphParticipants.length,
            captionCount: graphCaptions.length,
            source: sdkTranscriptSource
          }
        });
      }

      if (requireParticipantPanelRoster && participants.length === 0) {
        await this.appendLog(session, {
          level: "warn",
          phase: "capture",
          event: "teams_participant_panel_not_captured",
          message: "Teams participant panel was not captured; final participants remain empty instead of using caption speakers",
          status: "processing",
          metadata: {
            captionSpeakerCount: validatedCaptionSpeakers(captions).length,
            captionCount: captions.length
          }
        });
      }

      // Live persistence for the web detail page (which polls while the
      // session is in flight): the transcript is final at this point, so
      // store it now instead of holding everything for the single
      // completed-state write at the end of the pipeline.
      await this.update(session, {
        participants,
        captionsTimeline: captions,
        diarizedTranscript,
        transcriptText
      });

      await this.appendLog(session, {
        phase: "summary",
        event: "summary_started",
        message: "Summary generation started",
        status: "processing",
        metadata: { transcriptSegmentCount: diarizedTranscript.length, transcriptTextLength: transcriptText.length }
      });
      const summary = await new SummaryService(logger).summarize({ participants, transcript: diarizedTranscript, transcriptText });
      // Replace the diarized transcript with the sentiment-augmented version
      // produced by the summary service so the rest of the pipeline (artifact,
      // DB write, validation) sees per-segment sentiment.
      diarizedTranscript = summary.transcriptWithSentiment;
      if (summary.source !== "ai") {
        // The deterministic fallback fired (or AI returned an empty string).
        // Surface this to meetingLogs at warn level so the failure is visible
        // in the DB instead of being hidden behind a "summary_completed" line.
        await this.appendLog(session, {
          level: "warn",
          phase: "summary",
          event: "summary_fallback_used",
          message: "AI summary generation did not produce a usable result; deterministic fallback summary was stored",
          status: "processing",
          metadata: {
            source: summary.source,
            generationError: summary.generationError,
            summaryLength: summary.summary.length
          }
        });
      }
      // Adopt the AI-generated short title as the meeting name, overriding
      // whatever was captured from the meeting page title (e.g. the Meet code
      // "wag-ysjb-nqx"). This makes "meetingName" the single source of truth
      // for the human-readable meeting name across the UI.
      const resolvedName = resolveMeetingName({
        scheduledTitle: session.scheduledMeetingTitle,
        aiShortTitle: summary.shortTitle
      });
      if (resolvedName) {
        session.meetingName = resolvedName;
      }
      await this.appendLog(session, {
        phase: "summary",
        event: "summary_completed",
        message: "Summary generation completed",
        status: "processing",
        metadata: {
          summaryLength: summary.summary.length,
          meetingName: session.meetingName,
          chapterCount: summary.chapters.length,
          actionItemCount: summary.actionItems.length,
          source: summary.source,
          generationError: summary.generationError,
          overallSentiment: summary.sentimentSummary?.overall.label,
          sentimentScore: summary.sentimentSummary?.overall.score,
          sentimentMomentsCount: summary.sentimentSummary?.topMoments.length
        }
      });
      // Summary-stage live persistence: the page shows the summary, action
      // items, chapters and per-segment sentiment while the MoM report below
      // is still being generated. The MoM itself lands with the final
      // completed-state write.
      await this.update(session, {
        summary: summary.summary,
        chapters: summary.chapters,
        actionItems: summary.actionItems,
        ...(summary.sentimentSummary ? { sentimentSummary: summary.sentimentSummary } : {}),
        diarizedTranscript
      });

      const participantsTimeline =
        participantsTimelineOverride ??
        (requireParticipantPanelRoster
          ? participantTracker.getTimeline(endedAt)
          : mergeParticipantTimelines(participantTracker.getTimeline(endedAt), buildCaptionSpeakerTimeline(captions)));
      const meetingLogs = await this.loadMeetingLogs(sessionId);

      const resultStartedAt = joinedAt ?? new Date();
      const momReport = await new MomReportService(logger).generate({
        meetingTitle:
          session.meetingName?.trim() ||
          summary.summary?.split(/[.!?]/)[0]?.trim() ||
          session.sessionId,
        summary: summary.summary,
        participants,
        transcript: diarizedTranscript,
        transcriptText,
        actionItems: summary.actionItems,
        sentimentSummary: summary.sentimentSummary,
        durationSeconds: mediaDuration || secondsBetween(resultStartedAt, endedAt),
        meetingDate: resultStartedAt
      });
      await this.appendLog(session, {
        phase: "summary",
        event: "mom_report_generated",
        message: "Minutes-of-meeting report generated",
        status: "processing",
        metadata: {
          source: momReport.source,
          generationError: momReport.generationError,
          sectionCount: momReport.momSections.length,
          actionCount: momReport.actionItems.length,
          riskCount: momReport.risks.length
        }
      });
      const result: MeetingIntelligenceResult = {
        participants,
        participantsTimeline,
        captionsTimeline: captions,
        diarizedTranscript,
        transcriptText,
        summary: summary.summary,
        meetingName: session.meetingName,
        chapters: summary.chapters,
        actionItems: summary.actionItems,
        sentimentSummary: summary.sentimentSummary,
        meetingLogs,
        recordingUrl: recordingUpload.url,
        thumbnailUrl,
        momReport,
        startedAt: resultStartedAt,
        endedAt
      };

      validateCompletion(result, { speechExists, captionSpeechExists, allowEmptyTranscript: env.ALWAYS_COMPLETE_MEETINGS });
      await this.appendLog(session, {
        phase: "completion",
        event: "completion_validation_passed",
        message: "Meeting completion validation passed",
        status: "processing",
        metadata: { speechExists, captionSpeechExists }
      });

      await this.update(session, {
        ...result,
        status: "completed",
        errorMessage: undefined
      });
      await this.appendLog(session, {
        phase: "completion",
        event: "session_completed",
        message: "Meeting intelligence session completed",
        status: "completed",
        metadata: {
          participantCount: participants.length,
          captionCount: captions.length,
          diarizedSegmentCount: diarizedTranscript.length,
          duration: mediaDuration || secondsBetween(resultStartedAt, endedAt)
        }
      });

      await this.appendLog(session, {
        phase: "webhook",
        event: "completion_webhook_started",
        message: "Sending completion webhook",
        status: "completed",
        metadata: { hasWebhookUrl: Boolean(session.webhookUrl) }
      });
      const webhookResult = await new WebhookService(logger).sendCompleted(session.webhookUrl, {
        sessionId,
        recordingUrl: recordingUpload.url,
        duration: mediaDuration || secondsBetween(resultStartedAt, endedAt),
        participants
      });
      await this.appendLog(session, {
        level: webhookResult.error ? "warn" : "info",
        phase: "webhook",
        event: "completion_webhook_finished",
        message: "Completion webhook processing finished",
        status: "completed",
        metadata: { hasWebhookUrl: Boolean(session.webhookUrl), ...webhookResult }
      });

      logger.info(
        {
          participantCount: participants.length,
          captionCount: captions.length,
          diarizedSegmentCount: diarizedTranscript.length,
          duration: mediaDuration
        },
        "meeting intelligence completed"
      );
    } catch (error) {
      endedAt = new Date();
      captureCancelled = true;
      logger.error({ err: error }, "meeting intelligence failed");
      await this.appendLog(session, {
        level: "error",
        phase: "failure",
        event: "session_failed",
        message: "Meeting intelligence session failed",
        status: "failed",
        metadata: {
          endedAt: endedAt.toISOString(),
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        }
      }).catch(() => undefined);
      await bot.close().catch(() => undefined);
      await capturePromise?.catch(() => undefined);
      await this.update(session, {
        status: "failed",
        endedAt,
        errorMessage: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)
      });
      throw error;
    } finally {
      // Release the per-session sink and clone regardless of success/failure.
      // Without this, every concurrent bot leaks a PulseAudio module and a
      // ~100MB profile clone on disk.
      await unloadSink(perSessionSink).catch((error) =>
        logger.warn({ err: error, sinkName: perSessionSink?.sinkName }, "per-session sink unload failed")
      );
      if (sessionProfileDir) {
        await cleanupSessionBrowserProfile(sessionId).catch((error) =>
          logger.warn({ err: error, sessionProfileDir }, "per-session browser profile cleanup failed")
        );
      }
    }
  }

  private async prepareSessionIsolation(
    session: BotSessionDocument,
    sessionId: string
  ): Promise<{ sessionProfileDir: string | undefined; perSessionSink: PerSessionSink | undefined }> {
    let sessionProfileDir: string | undefined;
    if (env.BROWSER_PROFILE_PER_SESSION) {
      const templateDir = resolveProfileTemplateDir(session.platform);
      sessionProfileDir = await createSessionBrowserProfile(templateDir, sessionId);
      await this.appendLog(session, {
        phase: "browser",
        event: "session_profile_prepared",
        message: "Cloned per-session Chromium profile",
        status: "starting",
        metadata: { templateDir, sessionProfileDir }
      });
    }
    const perSessionSink = await loadPerSessionSink(sessionId);
    if (perSessionSink) {
      await this.appendLog(session, {
        phase: "browser",
        event: "session_audio_sink_loaded",
        message: "Per-session PulseAudio sink loaded",
        status: "starting",
        metadata: { sinkName: perSessionSink.sinkName, monitorSource: perSessionSink.monitorSource }
      });
    }
    return { sessionProfileDir, perSessionSink };
  }

  private async runMicrosoftTeamsSdkFlow(session: BotSessionDocument, logger: typeof rootLogger, paths: SessionMediaPaths): Promise<void> {
    const sessionId = session.sessionId;
    let endedAt = new Date();

    try {
      await this.updateStatus(session, "starting");
      await this.appendLog(session, {
        phase: "processing",
        event: "teams_sdk_flow_started",
        message: "Microsoft Teams Graph SDK flow started",
        status: "starting",
        metadata: { userId: env.TEAMS_GRAPH_USER_ID }
      });

      await this.updateStatus(session, "processing");
      await this.appendLog(session, {
        phase: "processing",
        event: "teams_sdk_transcript_collection_started",
        message: "Collecting Microsoft Teams transcript through Graph SDK",
        status: "processing",
        metadata: {
          pollIntervalMs: env.TEAMS_GRAPH_TRANSCRIPT_POLL_INTERVAL_MS,
          timeoutMs: env.TEAMS_GRAPH_TRANSCRIPT_TIMEOUT_MS
        }
      });

      const collection = await new MicrosoftTeamsSdkService(logger).collectTranscript(session.meetingUrl);
      if (collection.status === "pending") {
        await this.markTeamsTranscriptPending(session, collection.pending, 0);
        return;
      }

      await this.updateStatus(session, "transcript_ready");
      const teamsResult = collection.result;
      endedAt = teamsResult.endedAt;
      await this.appendLog(session, {
        phase: "transcription",
        event: "teams_sdk_transcript_collected",
        message: "Microsoft Teams Graph transcript collected",
        status: "processing",
        metadata: {
          onlineMeetingId: teamsResult.meeting.id,
          transcriptId: teamsResult.transcript.id,
          participantCount: teamsResult.participants.length,
          segmentCount: teamsResult.diarizedTranscript.length,
          transcriptTextLength: teamsResult.transcriptText.length
        }
      });

      await this.completeMicrosoftTeamsTranscript(session, logger, paths, teamsResult);

      logger.info(
        {
          participantCount: teamsResult.participants.length,
          diarizedSegmentCount: teamsResult.diarizedTranscript.length,
          duration: secondsBetween(teamsResult.startedAt, teamsResult.endedAt)
        },
        "microsoft teams sdk meeting intelligence completed"
      );
    } catch (error) {
      endedAt = new Date();
      logger.error({ err: error }, "microsoft teams sdk meeting intelligence failed");
      await this.appendLog(session, {
        level: "error",
        phase: "failure",
        event: "teams_sdk_session_failed",
        message: "Microsoft Teams SDK meeting intelligence session failed",
        status: "failed",
        metadata: {
          endedAt: endedAt.toISOString(),
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        }
      }).catch(() => undefined);
      await this.update(session, {
        status: "failed",
        endedAt,
        errorMessage: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)
      });
      throw error;
    }
  }

  async pollMicrosoftTeamsTranscript(sessionId: string, retryCount: number): Promise<void> {
    const session = await BotSessionModel.findOne({ sessionId });
    if (!session) throw new Error(`Bot session not found: ${sessionId}`);
    if (session.platform !== "microsoft_teams") throw new Error(`Transcript retry is only supported for Microsoft Teams sessions: ${sessionId}`);
    if (session.status === "completed") return;

    const logger = rootLogger.child({ sessionId, platform: session.platform, retryCount });
    const paths = await createSessionMediaPaths(sessionId);
    const onlineMeetingId = session.teamsOnlineMeetingId ?? session.transcriptPolling?.onlineMeetingId;
    if (!onlineMeetingId) {
      throw new Error(`Cannot retry Teams transcript polling without onlineMeetingId for session ${sessionId}`);
    }

    await this.appendLog(session, {
      phase: "retry",
      event: "transcript_poll_attempt",
      message: "Retrying Microsoft Teams transcript poll",
      status: "awaiting_transcript",
      metadata: {
        onlineMeetingId,
        retryCount,
        lastPollTimestamp: session.transcriptPolling?.lastPollAt,
        pendingDurationMs: session.transcriptPolling?.pendingDurationMs
      }
    });

    try {
      const collection = await new MicrosoftTeamsSdkService(logger).collectTranscriptForOnlineMeetingId(onlineMeetingId);
      if (collection.status === "pending") {
        await this.markTeamsTranscriptPending(session, collection.pending, retryCount);
        return;
      }

      await this.updateStatus(session, "transcript_ready");
      await this.appendLog(session, {
        phase: "transcription",
        event: "teams_sdk_transcript_collected",
        message: "Microsoft Teams Graph transcript collected by retry worker",
        status: "transcript_ready",
        metadata: {
          onlineMeetingId: collection.result.meeting.id,
          transcriptId: collection.result.transcript.id,
          retryCount,
          participantCount: collection.result.participants.length,
          segmentCount: collection.result.diarizedTranscript.length,
          transcriptTextLength: collection.result.transcriptText.length
        }
      });
      await this.completeMicrosoftTeamsTranscript(session, logger, paths, collection.result);
    } catch (error) {
      if (isPermanentTeamsGraphError(error)) {
        await this.appendLog(session, {
          level: "error",
          phase: "failure",
          event: "teams_sdk_retry_failed_permanently",
          message: "Microsoft Teams transcript retry failed with a permanent Graph error",
          status: "failed",
          metadata: {
            error: error instanceof Error ? error.message : String(error),
            retryCount
          }
        }).catch(() => undefined);
        await this.update(session, {
          status: "failed",
          endedAt: new Date(),
          errorMessage: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)
        });
        throw error;
      }

      await this.markTeamsTranscriptPending(session, {
        meeting: { id: onlineMeetingId },
        attempts: 1,
        firstPollAt: session.transcriptPolling?.firstPollAt ?? new Date(),
        lastPollAt: new Date(),
        pendingDurationMs: Date.now() - (session.transcriptPolling?.firstPollAt?.getTime() ?? Date.now())
      }, retryCount, error instanceof Error ? error.message : String(error));
    }
  }

  private async markTeamsTranscriptPending(
    session: BotSessionDocument,
    pending: TeamsTranscriptPendingResult,
    retryCount: number,
    lastGraphError?: string
  ): Promise<void> {
    const nextRetryCount = retryCount + 1;
    if (retryCount >= env.TEAMS_GRAPH_TRANSCRIPT_MAX_RETRY_ATTEMPTS) {
      const finalFailureReason = "Microsoft Teams transcript was never published";
      const pollAttemptCount = (session.transcriptPolling?.pollAttemptCount ?? 0) + pending.attempts;
      const firstPollAt = session.transcriptPolling?.firstPollAt ?? pending.firstPollAt;
      const pendingDurationMs = Date.now() - firstPollAt.getTime();

      await this.update(session, {
        status: "transcript_unavailable",
        teamsOnlineMeetingId: pending.meeting.id,
        transcriptPolling: {
          onlineMeetingId: pending.meeting.id,
          retryCount,
          pollAttemptCount,
          firstPollAt,
          lastPollAt: pending.lastPollAt,
          nextRetryAt: undefined,
          pendingDurationMs,
          lastGraphStatus: lastGraphError ? undefined : 200,
          lastGraphError,
          finalFailureReason
        },
        endedAt: new Date(),
        errorMessage: undefined
      });

      await this.appendLog(session, {
        level: "warn",
        phase: "retry",
        event: "teams_transcript_polling_exhausted",
        message: "Teams transcript polling exhausted after max retries",
        status: "transcript_unavailable",
        metadata: {
          onlineMeetingId: pending.meeting.id,
          retryCount,
          maxRetryAttempts: env.TEAMS_GRAPH_TRANSCRIPT_MAX_RETRY_ATTEMPTS,
          pollAttemptCount,
          pendingDurationMs,
          transcript_found: false,
          retry_exhausted: true,
          finalFailureReason,
          lastGraphError
        }
      });
      return;
    }

    const delayMs = teamsTranscriptRetryDelayMs(nextRetryCount);
    const nextRetryAt = new Date(Date.now() + delayMs);
    const pollAttemptCount = (session.transcriptPolling?.pollAttemptCount ?? 0) + pending.attempts;

    await this.update(session, {
      status: "awaiting_transcript",
      teamsOnlineMeetingId: pending.meeting.id,
      transcriptPolling: {
        onlineMeetingId: pending.meeting.id,
        retryCount: nextRetryCount,
        pollAttemptCount,
        firstPollAt: session.transcriptPolling?.firstPollAt ?? pending.firstPollAt,
        lastPollAt: pending.lastPollAt,
        nextRetryAt,
        pendingDurationMs: pending.pendingDurationMs,
        lastGraphStatus: lastGraphError ? undefined : 200,
        lastGraphError
      },
      errorMessage: undefined
    });

    await this.appendLog(session, {
      phase: "retry",
      event: "transcript_poll_attempt",
      message: "Microsoft Teams transcript is not available yet",
      status: "awaiting_transcript",
      metadata: {
        onlineMeetingId: pending.meeting.id,
        transcript_found: false,
        retryCount: nextRetryCount,
        pollAttemptCount,
        lastPollTimestamp: pending.lastPollAt,
        pendingDurationMs: pending.pendingDurationMs,
        transcript_pending_duration: pending.pendingDurationMs,
        graph_response_status: lastGraphError ? undefined : 200,
        retry_exhausted: false,
        lastGraphError
      }
    });

    await enqueueTeamsTranscriptRetry(session.sessionId, nextRetryCount, delayMs);
    await this.appendLog(session, {
      phase: "retry",
      event: "teams_transcript_retry_scheduled",
      message: "Microsoft Teams transcript retry scheduled",
      status: "awaiting_transcript",
      metadata: {
        onlineMeetingId: pending.meeting.id,
        retryCount: nextRetryCount,
        retryDelayMs: delayMs,
        nextRetryAt,
        retry_scheduled_at: nextRetryAt,
        pendingDurationMs: pending.pendingDurationMs,
        transcript_found: false,
        retry_exhausted: false
      }
    });
  }

  private async completeMicrosoftTeamsTranscript(
    session: BotSessionDocument,
    logger: typeof rootLogger,
    paths: SessionMediaPaths,
    teamsResult: TeamsSdkTranscriptResult
  ): Promise<void> {
    const sessionId = session.sessionId;
    await this.update(session, {
      status: "processing",
      teamsOnlineMeetingId: teamsResult.meeting.id,
      teamsTranscriptId: teamsResult.transcript.id,
      // Live persistence for the polling web detail page: the Graph
      // transcript is already final here, so store it before the summary and
      // MoM generation below run.
      participants: teamsResult.participants,
      participantsTimeline: teamsResult.participantsTimeline,
      captionsTimeline: teamsResult.captionsTimeline,
      diarizedTranscript: teamsResult.diarizedTranscript,
      transcriptText: teamsResult.transcriptText,
      transcriptPolling: {
        ...(session.transcriptPolling ?? { retryCount: 0, pollAttemptCount: 0 }),
        onlineMeetingId: teamsResult.meeting.id,
        transcriptId: teamsResult.transcript.id,
        lastPollAt: new Date(),
        nextRetryAt: undefined
      }
    });

    await this.appendLog(session, {
      phase: "summary",
      event: "summary_started",
      message: "Summary generation started",
      status: "processing",
      metadata: {
        transcriptSegmentCount: teamsResult.diarizedTranscript.length,
        transcriptTextLength: teamsResult.transcriptText.length
      }
    });
    const summary = await new SummaryService(logger).summarize({
      participants: teamsResult.participants,
      transcript: teamsResult.diarizedTranscript,
      transcriptText: teamsResult.transcriptText
    });
    const diarizedTranscriptWithSentiment = summary.transcriptWithSentiment;
    // Adopt the AI short title as the meeting name (Teams path mirror of the
    // generic orchestrator path above) — prefer the actual Teams subject when
    // present, otherwise fall back to the AI title we just generated.
    const resolvedName = resolveMeetingName({
      providerSubject: teamsResult.meeting.subject,
      scheduledTitle: session.scheduledMeetingTitle,
      aiShortTitle: summary.shortTitle
    });
    if (resolvedName) {
      session.meetingName = resolvedName;
    }
    await this.appendLog(session, {
      phase: "summary",
      event: "summary_completed",
      message: "Summary generation completed",
      status: "processing",
      metadata: {
        summaryLength: summary.summary.length,
        meetingName: session.meetingName,
        actionItemCount: summary.actionItems.length,
        overallSentiment: summary.sentimentSummary?.overall.label,
        sentimentScore: summary.sentimentSummary?.overall.score,
        sentimentMomentsCount: summary.sentimentSummary?.topMoments.length
      }
    });

    // Summary-stage live persistence (mirrors the recorded-audio path above)
    // so the polling detail page shows these while the MoM is generated.
    await this.update(session, {
      summary: summary.summary,
      chapters: summary.chapters,
      actionItems: summary.actionItems,
      ...(summary.sentimentSummary ? { sentimentSummary: summary.sentimentSummary } : {}),
      diarizedTranscript: diarizedTranscriptWithSentiment
    });

    const meetingLogs = await this.loadMeetingLogs(sessionId);
    const duration = secondsBetween(teamsResult.startedAt, teamsResult.endedAt);
    const momReport = await new MomReportService(logger).generate({
      meetingTitle:
        session.meetingName?.trim() ||
        summary.summary?.split(/[.!?]/)[0]?.trim() ||
        session.sessionId,
      summary: summary.summary,
      participants: teamsResult.participants,
      transcript: diarizedTranscriptWithSentiment,
      transcriptText: teamsResult.transcriptText,
      actionItems: summary.actionItems,
      sentimentSummary: summary.sentimentSummary,
      durationSeconds: duration,
      meetingDate: teamsResult.startedAt
    });
    const result: MeetingIntelligenceResult = {
      participants: teamsResult.participants,
      participantsTimeline: teamsResult.participantsTimeline,
      captionsTimeline: teamsResult.captionsTimeline,
      diarizedTranscript: diarizedTranscriptWithSentiment,
      transcriptText: teamsResult.transcriptText,
      summary: summary.summary,
      meetingName: session.meetingName,
      chapters: summary.chapters,
      actionItems: summary.actionItems,
      sentimentSummary: summary.sentimentSummary,
      meetingLogs,
      momReport,
      recordingUrl: "",
      startedAt: teamsResult.startedAt,
      endedAt: teamsResult.endedAt
    };

    validateCompletion(result, { speechExists: true, requireRecording: false });
    await this.appendLog(session, {
      phase: "completion",
      event: "completion_validation_passed",
      message: "Microsoft Teams SDK completion validation passed",
      status: "processing",
      metadata: { requireRecording: false }
    });

    await this.update(session, {
      ...result,
      teamsOnlineMeetingId: teamsResult.meeting.id,
      teamsTranscriptId: teamsResult.transcript.id,
      ...(teamsResult.meeting.subject ? { meetingName: teamsResult.meeting.subject } : {}),
      status: "completed",
      errorMessage: undefined
    });
    await this.appendLog(session, {
      phase: "completion",
      event: "session_completed",
      message: "Microsoft Teams SDK meeting intelligence session completed",
      status: "completed",
      metadata: {
        participantCount: teamsResult.participants.length,
        captionCount: teamsResult.captionsTimeline.length,
        diarizedSegmentCount: teamsResult.diarizedTranscript.length,
        duration
      }
    });

    await this.appendLog(session, {
      phase: "webhook",
      event: "completion_webhook_started",
      message: "Sending completion webhook",
      status: "completed",
      metadata: { hasWebhookUrl: Boolean(session.webhookUrl) }
    });
    const webhookResult = await new WebhookService(logger).sendCompleted(session.webhookUrl, {
      sessionId,
      recordingUrl: "",
      duration,
      participants: teamsResult.participants
    });
    await this.appendLog(session, {
      level: webhookResult.error ? "warn" : "info",
      phase: "webhook",
      event: "completion_webhook_finished",
      message: "Completion webhook processing finished",
      status: "completed",
      metadata: { hasWebhookUrl: Boolean(session.webhookUrl), ...webhookResult }
    });
  }

  private async captureMeeting(
    session: BotSessionDocument,
    bot: ReturnType<typeof createMeetingBot>,
    participantTracker: ParticipantTracker,
    captionTracker: CaptionTracker,
    logger: typeof rootLogger,
    getJoinedAt: () => Date | undefined,
    shouldStop: () => boolean
  ): Promise<void> {
    const startedAt = Date.now();
    let panelNamesEverFound = false;
    let lastParticipantSnapshotAt = 0;
    let lastMongoFlushAt = 0;
    let aloneSinceMs: number | null = null;
    let everSawOtherParticipant = false;
    // Idle (silence) auto-leave: track when we last accepted a *new* caption.
    // Armed only after the first caption is seen so a captions-never-enabled
    // session can't trip it while people are actually talking.
    let lastCaptionActivityMs = Date.now();
    let everSawCaption = false;
    const PANEL_RETRY_INTERVAL_MS = 5000; // Retry more aggressively until we get panel names at least once
    const autoLeaveAfterAloneMs = cfgNumber("BOT_AUTO_LEAVE_WHEN_ALONE_MS") ?? env.BOT_AUTO_LEAVE_WHEN_ALONE_MS;
    const autoLeaveWhenIdleMs = cfgNumber("BOT_AUTO_LEAVE_WHEN_IDLE_MS") ?? env.BOT_AUTO_LEAVE_WHEN_IDLE_MS;
    const noShowTimeoutMs = cfgNumber("BOT_NO_SHOW_TIMEOUT_MS") ?? env.BOT_NO_SHOW_TIMEOUT_MS;
    const maxMeetingMs = (cfgNumber("MAX_MEETING_SECONDS") ?? env.MAX_MEETING_SECONDS) * 1000;

    while (!shouldStop() && Date.now() - startedAt < maxMeetingMs) {
      await bot.dismissOverlays().catch((error) => logger.debug({ err: error }, "overlay dismissal failed"));

      const captionSamples = await bot.snapshotCaptions().catch((error) => {
        logger.debug({ err: error }, "caption snapshot failed");
        return [];
      });
      const addedCaptions = captionTracker.addMany(captionSamples);
      if (addedCaptions.length > 0) {
        lastCaptionActivityMs = Date.now();
        everSawCaption = true;
        logger.debug({ addedCaptionCount: addedCaptions.length }, "caption samples accepted");
        // Register caption-derived speakers in the participant tracker as soon
        // as we hear them. The panel poller may not see late joiners for a
        // while (Meet's panel can hide names behind self-view); meanwhile the
        // captions already carry their display names. Without this, the live
        // DB row only contains panel-observed participants until the very end
        // of post-processing.
        const captionSpeakers = validatedCaptionSpeakers(captionTracker.values()).map(
          (participant) => participant.name
        );
        if (captionSpeakers.length > 0) {
          participantTracker.observe(captionSpeakers, "caption_label");
        }
      }

      // Use shorter interval until we successfully get panel names, then switch to normal interval
      const effectiveInterval = panelNamesEverFound ? env.PARTICIPANT_PANEL_INTERVAL_MS : PANEL_RETRY_INTERVAL_MS;
      const shouldSnapshotParticipants = getJoinedAt() && (Date.now() - lastParticipantSnapshotAt >= effectiveInterval);

      if (shouldSnapshotParticipants) {
        lastParticipantSnapshotAt = Date.now();
        const participantNames = await bot.snapshotParticipants().catch((error) => {
          logger.debug({ err: error }, "participant panel snapshot failed");
          return [];
        });
        const participantDebug = getParticipantSnapshotDebug(bot);
        const observed = participantTracker.observe(participantNames, "participant_panel");
        // Use the cleaned `observed` count, not raw participantNames. Raw names
        // can include panel artifacts ("Leave (Ctrl+Shift+H)", "gVoice AI Bot"
        // etc.) that look non-empty but resolve to zero real participants
        // after cleanParticipantName runs. Without this, the alone-timer
        // resets on every poll and auto-leave never fires.
        if (observed.length > 0) {
          panelNamesEverFound = true;
          everSawOtherParticipant = true;
          if (aloneSinceMs !== null) {
            const elapsed = Date.now() - aloneSinceMs;
            aloneSinceMs = null;
            logger.info({ elapsedMs: elapsed }, "alone timer cleared — participant observed again");
          }
        } else if (panelNamesEverFound && everSawOtherParticipant) {
          // We previously saw other participants but this snapshot has no real
          // ones — the bot may be alone. Start (or continue) the alone timer;
          // once it exceeds the configured grace period, leave the meeting.
          if (aloneSinceMs === null) {
            aloneSinceMs = Date.now();
            logger.info({ autoLeaveAfterMs: autoLeaveAfterAloneMs }, "alone timer started — bot has no other participants");
          }
        }
        logger.info(
          {
            participantCount: participantTracker.getParticipants().length,
            observed: observed.length,
            rawParticipantNameCount: participantNames.length,
            panelNamesEverFound,
            participantDebug
          },
          "participant snapshot complete"
        );
        await this.appendLog(session, {
          phase: "capture",
          event: "participant_snapshot",
          message: "Participant snapshot captured",
          status: "recording",
          metadata: {
            participantCount: participantTracker.getParticipants().length,
            observedCount: observed.length,
            rawParticipantNameCount: participantNames.length,
            panelNamesEverFound,
            participantDebug
          }
        });
      }

      if (Date.now() - lastMongoFlushAt >= 30000) {
        await this.update(session, {
          participants: participantTracker.getParticipants(),
          participantsTimeline: participantTracker.getTimeline(),
          captionsTimeline: captionTracker.values()
        });
        lastMongoFlushAt = Date.now();
        logger.info(
          {
            participantCount: participantTracker.getParticipants().length,
            captionCount: captionTracker.values().length
          },
          "capture progress"
        );
        await this.appendLog(session, {
          phase: "capture",
          event: "live_capture_progress",
          message: "Live meeting capture progress saved",
          status: "recording",
          metadata: {
            participantCount: participantTracker.getParticipants().length,
            captionCount: captionTracker.values().length,
            addedCaptionCount: addedCaptions.length,
            panelNamesEverFound
          }
        });
      }

      if (getJoinedAt() && (await bot.hasMeetingEnded().catch(() => false))) {
        logger.info("meeting end detected");
        await this.appendLog(session, {
          phase: "capture",
          event: "meeting_end_detected",
          message: "Meeting end detected by bot",
          status: "recording"
        });
        break;
      }

      if (
        getJoinedAt() &&
        autoLeaveAfterAloneMs > 0 &&
        aloneSinceMs !== null &&
        Date.now() - aloneSinceMs >= autoLeaveAfterAloneMs
      ) {
        const aloneForMs = Date.now() - aloneSinceMs;
        logger.info({ aloneForMs }, "bot alone in meeting beyond grace period; auto-leaving");
        const left = await bot.leaveMeeting().catch((error) => {
          logger.warn({ err: error }, "auto-leave click failed");
          return false;
        });
        await this.appendLog(session, {
          phase: "capture",
          event: "bot_auto_leave_triggered",
          message: "Bot alone for grace period — auto-leaving meeting",
          status: "recording",
          metadata: { aloneForMs, leaveControlClicked: left }
        });
        break;
      }

      if (
        getJoinedAt() &&
        noShowTimeoutMs > 0 &&
        !everSawOtherParticipant &&
        Date.now() - getJoinedAt()!.getTime() >= noShowTimeoutMs
      ) {
        const waitedMs = Date.now() - getJoinedAt()!.getTime();
        logger.info({ waitedMs }, "no other participant joined within no-show window; auto-leaving");
        const left = await bot.leaveMeeting().catch((error) => {
          logger.warn({ err: error }, "no-show auto-leave click failed");
          return false;
        });
        await this.appendLog(session, {
          phase: "capture",
          event: "bot_auto_leave_no_show_triggered",
          message: "No other participant joined within no-show window — auto-leaving meeting",
          status: "recording",
          metadata: { waitedMs, leaveControlClicked: left }
        });
        break;
      }

      if (
        getJoinedAt() &&
        autoLeaveWhenIdleMs > 0 &&
        everSawCaption &&
        Date.now() - lastCaptionActivityMs >= autoLeaveWhenIdleMs
      ) {
        const idleForMs = Date.now() - lastCaptionActivityMs;
        logger.info({ idleForMs }, "meeting silent beyond idle grace period; auto-leaving");
        const left = await bot.leaveMeeting().catch((error) => {
          logger.warn({ err: error }, "idle auto-leave click failed");
          return false;
        });
        await this.appendLog(session, {
          phase: "capture",
          event: "bot_auto_leave_idle_triggered",
          message: "Meeting silent beyond idle grace period — auto-leaving meeting",
          status: "recording",
          metadata: { idleForMs, leaveControlClicked: left }
        });
        break;
      }

      await delay(env.CAPTURE_INTERVAL_MS);
    }
  }

  private async updateStatus(session: BotSessionDocument, status: BotStatus): Promise<void> {
    await this.update(session, { status });
    await this.appendLog(session, {
      phase: "session",
      event: "status_changed",
      message: `Session status changed to ${status}`,
      status
    });
  }

  private async update(session: BotSessionDocument, patch: Partial<BotSession>): Promise<void> {
    session.set(patch);
    await session.save();
  }

  private async appendLog(session: BotSessionDocument, input: Parameters<typeof appendMeetingLog>[1]): Promise<void> {
    await appendMeetingLog(session.sessionId, input);
  }

  private async loadMeetingLogs(sessionId: string) {
    const session = await BotSessionModel.findOne({ sessionId }, { meetingLogs: 1 }).lean();
    return session?.meetingLogs ?? [];
  }
}

function resolveProfileTemplateDir(platform: BotSession["platform"]): string {
  switch (platform) {
    case "google_meet":
      return env.GOOGLE_USER_DATA_DIR;
    case "microsoft_teams":
      return env.TEAMS_USER_DATA_DIR;
    case "zoom":
      return env.ZOOM_USER_DATA_DIR;
    default:
      throw new Error(`Unsupported platform for profile template: ${platform satisfies never}`);
  }
}

function validatedDiarizationParticipants(segments: DiarizedTranscriptSegment[]): Participant[] {
  return dedupeParticipants(
    segments
      .map((segment) => cleanParticipantName(segment.speaker))
      .filter((name): name is string => Boolean(name))
      .filter((name) => !/^speaker$/i.test(name))
      .map((name) => ({ name, source: "diarization_cluster" }))
  );
}

function getParticipantSnapshotDebug(bot: ReturnType<typeof createMeetingBot>): Record<string, unknown> | undefined {
  const maybeDebuggable = bot as { getLastParticipantSnapshotDebug?: () => Record<string, unknown> | undefined };
  return maybeDebuggable.getLastParticipantSnapshotDebug?.();
}

function teamsTranscriptRetryDelayMs(retryCount: number): number {
  const configured = env.TEAMS_GRAPH_TRANSCRIPT_RETRY_DELAYS_MS.split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (configured.length === 0) return 5 * 60 * 1000;
  const boundedRetryCount = Math.min(Math.max(retryCount, 1), env.TEAMS_GRAPH_TRANSCRIPT_MAX_RETRY_ATTEMPTS);
  return configured[Math.min(boundedRetryCount - 1, configured.length - 1)];
}

function isPermanentTeamsGraphError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /insufficient permissions|forbidden|3003|does not have access|organizer|tenant .*does not match|invalid|unauthorized|auth/i.test(message);
}

function isTeamsTranscriptInSessionWindow(result: TeamsSdkTranscriptResult, joinedAt: Date | undefined, endedAt: Date): boolean {
  if (!joinedAt) return true;
  const transcriptStart = result.startedAt.getTime();
  const transcriptEnd = result.endedAt.getTime();
  const sessionStart = joinedAt.getTime() - 5 * 60 * 1000;
  const sessionEnd = endedAt.getTime() + 5 * 60 * 1000;
  return transcriptEnd >= sessionStart && transcriptStart <= sessionEnd;
}

function isZoomTranscriptInSessionWindow(result: ZoomCloudTranscriptResult, joinedAt: Date | undefined, endedAt: Date): boolean {
  if (!joinedAt) return true;
  const transcriptStart = result.startedAt.getTime();
  const transcriptEnd = result.endedAt.getTime();
  const sessionStart = joinedAt.getTime() - 5 * 60 * 1000;
  const sessionEnd = endedAt.getTime() + 5 * 60 * 1000;
  return transcriptEnd >= sessionStart && transcriptStart <= sessionEnd;
}

function mergeCaptionTimelines(
  primary: ReturnType<CaptionTracker["values"]>,
  secondary: ReturnType<CaptionTracker["values"]>
): ReturnType<CaptionTracker["values"]> {
  const seen = new Set<string>();
  const merged = [...primary, ...secondary].filter((caption) => {
    const key = `${caption.speaker ?? ""}|${caption.text}|${caption.time.getTime()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return merged.sort((a, b) => a.time.getTime() - b.time.getTime());
}
