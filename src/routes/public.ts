import { Router } from "express";
import { getSharedMeeting, getSharedRecordingUrl } from "../services/meetingShare";
import { signBlobReadUrl } from "../storage/azureBlobStorage";

// Unauthenticated, read-only access to meetings that have an ENABLED public
// share link. Everything here is keyed on the unguessable share token and
// returns only sanitized presentation data (see getSharedMeeting). Mounted at
// /api/public — NOT behind requireAuth.
export const publicRouter = Router();

publicRouter.get("/meetings/:token", async (req, res, next) => {
  try {
    const meeting = await getSharedMeeting(String(req.params.token));
    if (!meeting) {
      res.status(404).json({ error: "This shared meeting is unavailable" });
      return;
    }
    // Public content is immutable per token; allow brief CDN/browser caching.
    res.setHeader("Cache-Control", "public, max-age=30");
    res.json(meeting);
  } catch (error) {
    next(error);
  }
});

// Stream the recording for a shared meeting INLINE (so it plays in the <video>
// element) with Range support for seeking. Proxied through us — and re-checked
// against the token on every request — so revoking the link kills video access
// immediately (a direct SAS URL would keep working until it expired).
publicRouter.get("/meetings/:token/recording", async (req, res, next) => {
  try {
    const rawUrl = await getSharedRecordingUrl(String(req.params.token));
    if (!rawUrl) {
      res.status(404).json({ error: "Recording not available" });
      return;
    }
    const signedUrl = signBlobReadUrl(rawUrl);
    if (!signedUrl) {
      res.status(404).json({ error: "Recording not available" });
      return;
    }

    const upstreamHeaders: Record<string, string> = {};
    if (req.headers.range) upstreamHeaders.range = String(req.headers.range);

    const upstream = await fetch(signedUrl, { headers: upstreamHeaders });
    if (!upstream.ok || !upstream.body) {
      res.status(502).json({ error: "Failed to fetch recording" });
      return;
    }

    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "video/mp4");
    const len = upstream.headers.get("content-length");
    if (len) res.setHeader("Content-Length", len);
    const range = upstream.headers.get("content-range");
    if (range) res.setHeader("Content-Range", range);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, no-store");

    const { Readable } = await import("node:stream");
    const { pipeline } = await import("node:stream/promises");
    await pipeline(Readable.fromWeb(upstream.body as never), res);
  } catch (error) {
    next(error);
  }
});
