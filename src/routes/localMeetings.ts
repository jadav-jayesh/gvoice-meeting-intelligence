import os from "node:os";
import path from "node:path";
import { unlink } from "node:fs/promises";
import { Router } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { BotSessionModel } from "../models/BotSession";
import { AzureBlobStorage } from "../storage/azureBlobStorage";
import { enqueueLocalProcess } from "../queue/botQueue";
import { requireAuth } from "../middleware/requireAuth";
import { requireCsrf } from "../middleware/requireCsrf";
import { appendMeetingLog } from "../services/meetingLogService";
import { logger } from "../utils/logger";

// In-person (local) meetings: the phone records room audio and uploads the file
// here. We store it, then enqueue the SAME processing pipeline used for bot
// recordings (transcript / diarization / summary / MoM / sentiment). No bot,
// no meeting URL — see MeetingOrchestrator.processLocalUpload().

const upload = multer({
  dest: path.join(os.tmpdir(), "gvoice-uploads"),
  limits: { fileSize: 600 * 1024 * 1024 } // ~10 h of m4a
});

export const localMeetingsRouter = Router();

localMeetingsRouter.use(requireAuth);
localMeetingsRouter.use(requireCsrf);

// POST /api/meetings/local  (multipart/form-data)
//   audio         : the recorded file (required)
//   meetingName   : text (optional)
//   participants  : JSON array of names (optional) — improves speaker labels
localMeetingsRouter.post("/", upload.single("audio"), async (req, res, next) => {
  const file = req.file;
  try {
    if (!file) {
      res.status(400).json({ error: "audio_file_required" });
      return;
    }

    const meetingName = typeof req.body.meetingName === "string" && req.body.meetingName.trim()
      ? req.body.meetingName.trim().slice(0, 200)
      : "In-person meeting";

    let participants: Array<{ name: string; source: string }> = [];
    if (typeof req.body.participants === "string" && req.body.participants.trim()) {
      try {
        const parsed = JSON.parse(req.body.participants);
        if (Array.isArray(parsed)) {
          participants = parsed
            .filter((n) => typeof n === "string" && n.trim())
            .slice(0, 50)
            .map((n: string) => ({ name: n.trim().slice(0, 120), source: "manual" }));
        }
      } catch {
        // ignore malformed participants — they're optional
      }
    }

    const sessionId = uuidv4();
    await BotSessionModel.create({
      sessionId,
      userId: req.user!.id,
      accessUserIds: [req.user!.id],
      platform: "in_person",
      meetingUrl: "",
      meetingName,
      participants,
      status: "uploading",
      startedAt: new Date(),
      meetingLogs: [
        {
          time: new Date(),
          level: "info",
          phase: "session",
          event: "session_created",
          message: "In-person meeting created",
          status: "uploading",
          metadata: { platform: "in_person", originalName: file.originalname, sizeBytes: file.size }
        }
      ]
    });

    // Store the uploaded audio as the meeting recording, then hand off to the worker.
    const storage = new AzureBlobStorage();
    const contentType = file.mimetype || "audio/mp4";
    const uploaded = await storage.uploadFile(file.path, storage.recordingBlobName(sessionId), contentType);

    await BotSessionModel.updateOne({ sessionId }, { recordingUrl: uploaded.url, status: "processing" });
    await enqueueLocalProcess(sessionId);
    await appendMeetingLog(sessionId, {
      phase: "queue",
      event: "job_enqueued",
      message: "In-person processing job enqueued",
      status: "processing"
    });

    res.status(202).json({ sessionId, status: "processing" });
  } catch (error) {
    logger.error({ err: error }, "local meeting upload failed");
    next(error);
  } finally {
    // Always clean up the temp upload.
    if (file?.path) await unlink(file.path).catch(() => undefined);
  }
});
