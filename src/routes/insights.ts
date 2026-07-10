import { Router } from "express";
import { z } from "zod";
import { BotSessionModel } from "../models/BotSession";
import { requireAuth } from "../middleware/requireAuth";

// Read-only aggregation endpoints powering the Dashboard action-items widget and
// the Insights participation/topics widgets. Everything here is additive: it
// only READS existing BotSession fields (momReport, diarizedTranscript,
// chapters) and computes in Node — no schema, model, or processing changes, and
// no Cosmos aggregation pipeline (its Mongo API support is partial). Visibility
// is scoped to the viewer via accessUserIds (served by the existing
// {accessUserIds:1, createdAt:-1} index) and an optional time range.

export const insightsRouter = Router();
insightsRouter.use(requireAuth);

const rangeSchema = z.object({
  range: z.enum(["7d", "30d", "90d", "all"]).default("30d")
});

const RANGE_DAYS: Record<string, number | null> = { "7d": 7, "30d": 30, "90d": 90, all: null };

// Safety cap so a huge corpus can't make one request scan unbounded rows. The
// widgets are "recent activity" views, so the newest N within the range is the
// right sample; we log nothing dropped here because the range already bounds it.
const MAX_SCAN = 500;

/** Build the scoped + time-ranged filter shared by every endpoint. */
function scopedFilter(userId: string, range: string): Record<string, unknown> {
  const days = RANGE_DAYS[range];
  const filter: Record<string, unknown> = { accessUserIds: userId };
  if (days != null) {
    filter.createdAt = { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) };
  }
  return filter;
}

// ── 1. Action items (Dashboard) ─────────────────────────────────────────────

/**
 * Best-effort overdue check. MoM `due` is free text ("Sep 13", "2026-07-01",
 * "next Friday"). We only flag overdue when we can confidently parse a date in
 * the past; anything unparseable is treated as "no due date" (never overdue) so
 * we don't raise false alarms.
 */
function parseDue(due: string | undefined): number | null {
  if (!due) return null;
  const raw = due.trim();
  if (!raw) return null;
  let ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    // Try appending the current year for bare "Sep 13" style strings.
    ms = Date.parse(`${raw} ${new Date().getFullYear()}`);
  }
  return Number.isNaN(ms) ? null : ms;
}

insightsRouter.get("/action-items", async (req, res, next) => {
  try {
    const { range } = rangeSchema.parse(req.query);
    const sessions = await BotSessionModel.find(scopedFilter(req.user!.id, range), {
      "momReport.actionItems": 1,
      meetingName: 1,
      sessionId: 1
    })
      .sort({ createdAt: -1 })
      .limit(MAX_SCAN)
      .lean();

    const now = Date.now();
    let total = 0;
    let done = 0;
    const byOwner = new Map<string, { open: number; total: number }>();
    const byPriority: Record<string, number> = { high: 0, medium: 0, low: 0 };
    const overdue: Array<{ task: string; owner: string; due: string; sessionId: string }> = [];

    for (const s of sessions) {
      const list = s.momReport?.actionItems ?? [];
      for (const a of list) {
        total += 1;
        const isDone = a.status === "done";
        if (isDone) done += 1;
        if (a.priority && byPriority[a.priority] != null) byPriority[a.priority] += 1;

        const owners = a.owners?.length ? a.owners : a.owner ? [a.owner] : ["Unassigned"];
        for (const owner of owners) {
          const cur = byOwner.get(owner) ?? { open: 0, total: 0 };
          cur.total += 1;
          if (!isDone) cur.open += 1;
          byOwner.set(owner, cur);
        }

        const dueMs = parseDue(a.due);
        if (!isDone && dueMs != null && dueMs < now) {
          overdue.push({
            task: a.task,
            owner: owners[0],
            due: a.due!,
            sessionId: s.sessionId
          });
        }
      }
    }

    res.json({
      total,
      done,
      open: total - done,
      completionRate: total ? Math.round((done / total) * 100) : 0,
      byPriority,
      byOwner: Array.from(byOwner.entries())
        .map(([owner, v]) => ({ owner, ...v }))
        .sort((a, b) => b.open - a.open || b.total - a.total)
        .slice(0, 5),
      overdue: overdue.slice(0, 10),
      overdueCount: overdue.length
    });
  } catch (error) {
    next(error);
  }
});

// ── 2. Participation / talk-time (Insights) ─────────────────────────────────

insightsRouter.get("/participation", async (req, res, next) => {
  try {
    const { range } = rangeSchema.parse(req.query);
    const sessions = await BotSessionModel.find(scopedFilter(req.user!.id, range), {
      diarizedTranscript: 1
    })
      .sort({ createdAt: -1 })
      .limit(MAX_SCAN)
      .lean();

    const talk = new Map<string, { seconds: number; meetings: number }>();
    for (const s of sessions) {
      const segs = s.diarizedTranscript ?? [];
      const seenThisMeeting = new Set<string>();
      for (const seg of segs) {
        const name = seg.speaker?.trim();
        if (!name) continue;
        const dur = Math.max(0, (seg.endTime ?? 0) - (seg.startTime ?? 0));
        const cur = talk.get(name) ?? { seconds: 0, meetings: 0 };
        cur.seconds += dur;
        if (!seenThisMeeting.has(name)) {
          cur.meetings += 1;
          seenThisMeeting.add(name);
        }
        talk.set(name, cur);
      }
    }

    const totalTalkSeconds = Array.from(talk.values()).reduce((sum, v) => sum + v.seconds, 0);
    const speakers = Array.from(talk.entries())
      .map(([name, v]) => ({
        name,
        talkSeconds: Math.round(v.seconds),
        meetings: v.meetings,
        share: totalTalkSeconds ? v.seconds / totalTalkSeconds : 0
      }))
      .sort((a, b) => b.talkSeconds - a.talkSeconds)
      .slice(0, 8);

    res.json({ speakers, totalTalkSeconds: Math.round(totalTalkSeconds) });
  } catch (error) {
    next(error);
  }
});

// ── 3. Topics / themes (Insights) ───────────────────────────────────────────

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "with", "review",
  "meeting", "sync", "call", "discussion", "update", "updates", "weekly", "daily",
  "standup", "catch", "up", "check", "chat", "session", "general"
]);

/** Normalize a chapter/meeting title into a comparable theme key. */
function normalizeTitle(title: string): { key: string; label: string } | null {
  const label = title.trim().replace(/\s+/g, " ");
  if (label.length < 3) return null;
  const tokens = label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  if (tokens.length === 0) return null;
  return { key: tokens.slice(0, 4).join(" "), label };
}

insightsRouter.get("/topics", async (req, res, next) => {
  try {
    const { range } = rangeSchema.parse(req.query);
    const sessions = await BotSessionModel.find(scopedFilter(req.user!.id, range), {
      "chapters.title": 1,
      meetingName: 1,
      sessionId: 1
    })
      .sort({ createdAt: -1 })
      .limit(MAX_SCAN)
      .lean();

    const topics = new Map<string, { count: number; label: string; sessions: Set<string> }>();
    for (const s of sessions) {
      const titles = (s.chapters ?? []).map((c) => c.title).filter(Boolean) as string[];
      // Fall back to the meeting name when a session has no chapters.
      if (titles.length === 0 && s.meetingName) titles.push(s.meetingName);
      const seenKeys = new Set<string>();
      for (const title of titles) {
        const norm = normalizeTitle(title);
        if (!norm || seenKeys.has(norm.key)) continue;
        seenKeys.add(norm.key);
        const cur = topics.get(norm.key) ?? { count: 0, label: norm.label, sessions: new Set<string>() };
        cur.count += 1;
        cur.sessions.add(s.sessionId);
        topics.set(norm.key, cur);
      }
    }

    res.json({
      topics: Array.from(topics.values())
        .map((t) => ({ label: t.label, count: t.count, sessions: Array.from(t.sessions).slice(0, 5) }))
        .filter((t) => t.count >= 1)
        .sort((a, b) => b.count - a.count)
        .slice(0, 12)
    });
  } catch (error) {
    next(error);
  }
});
