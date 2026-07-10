import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { UserModel, userRoles, type UserRole } from "../models/User";
import { BotSessionModel } from "../models/BotSession";
import { requireAuth } from "../middleware/requireAuth";
import { requireAdmin } from "../middleware/requireAdmin";
import { requireCsrf } from "../middleware/requireCsrf";
import { logger } from "../utils/logger";

export const adminRouter = Router();

// Every admin route requires a logged-in user whose DB role is "admin".
adminRouter.use(requireAuth, requireAdmin);

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(200).optional(),
  role: z.enum(userRoles).optional(),
  sort: z.enum(["createdAt", "email", "name"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc")
});

const SORT_FIELDS: Record<string, Record<string, 1 | -1>> = {
  createdAt: { createdAt: -1 },
  email: { email: 1 },
  name: { firstName: 1, lastName: 1 }
};

// Per-user usage (owned meetings only — userId is the creator; accessUserIds
// also holds shared viewers, which we deliberately don't count as the viewer's
// own usage). Computed in Node over the current page's users — fine at present
// volume; revisit with a stored aggregate if user/meeting counts grow large.
async function usageForUsers(userIds: Types.ObjectId[]): Promise<Map<string, { meetingCount: number; minutes: number }>> {
  const usage = new Map<string, { meetingCount: number; minutes: number }>();
  if (userIds.length === 0) return usage;

  const sessions = await BotSessionModel.find({ userId: { $in: userIds } })
    .select("userId startedAt endedAt")
    .lean();

  for (const session of sessions) {
    if (!session.userId) continue;
    const key = String(session.userId);
    const entry = usage.get(key) ?? { meetingCount: 0, minutes: 0 };
    entry.meetingCount += 1;
    if (session.startedAt && session.endedAt) {
      const ms = new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime();
      if (ms > 0) entry.minutes += ms / 60000;
    }
    usage.set(key, entry);
  }
  return usage;
}

// GET /api/admin/users — paginated user directory with per-user usage.
adminRouter.get("/users", async (req, res, next) => {
  try {
    const query = listQuerySchema.parse(req.query);

    const filter: Record<string, unknown> = {};
    if (query.role) filter.role = query.role;
    if (query.search) {
      const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(escaped, "i");
      filter.$or = [{ email: re }, { firstName: re }, { lastName: re }];
    }

    const baseSort = SORT_FIELDS[query.sort];
    const sortSpec =
      query.order === "asc"
        ? Object.fromEntries(Object.entries(baseSort).map(([k]) => [k, 1 as const]))
        : Object.fromEntries(Object.entries(baseSort).map(([k]) => [k, -1 as const]));

    const skip = (query.page - 1) * query.pageSize;
    const [users, total] = await Promise.all([
      UserModel.find(filter)
        .select("email firstName lastName role createdAt")
        .sort(sortSpec)
        .skip(skip)
        .limit(query.pageSize)
        .lean(),
      UserModel.countDocuments(filter)
    ]);

    const usage = await usageForUsers(users.map((u) => u._id));

    const items = users.map((u) => {
      const u2 = usage.get(String(u._id));
      return {
        id: String(u._id),
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        createdAt: u.createdAt,
        meetingCount: u2?.meetingCount ?? 0,
        minutes: Math.round(u2?.minutes ?? 0)
      };
    });

    res.json({
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: skip + items.length < total
    });
  } catch (error) {
    next(error);
  }
});

const roleSchema = z.object({ role: z.enum(userRoles) });

export type RoleChangeDecision =
  | { ok: true; changed: boolean }
  | { ok: false; status: number; error: string };

// Pure guard logic for a role change, separated from the request/DB plumbing so
// it can be unit-tested. Rules:
//  - An admin can never demote themselves (prevents accidental self-lockout).
//  - A no-op (same role) is allowed and reported as changed:false.
//  - The final remaining admin can't be demoted (keeps ≥1 admin alive).
export function evaluateRoleChange(input: {
  actorId: string;
  targetId: string;
  targetCurrentRole: UserRole;
  requestedRole: UserRole;
  adminCount: number;
}): RoleChangeDecision {
  const { actorId, targetId, targetCurrentRole, requestedRole, adminCount } = input;

  if (targetId === actorId && requestedRole !== "admin") {
    return { ok: false, status: 400, error: "cannot change your own admin role" };
  }
  if (targetCurrentRole === requestedRole) {
    return { ok: true, changed: false };
  }
  if (targetCurrentRole === "admin" && requestedRole !== "admin" && adminCount <= 1) {
    return { ok: false, status: 400, error: "cannot demote the last admin" };
  }
  return { ok: true, changed: true };
}

// PATCH /api/admin/users/:id/role — promote/demote a user.
adminRouter.patch("/users/:id/role", requireCsrf, async (req, res, next) => {
  try {
    const { role } = roleSchema.parse(req.body);
    const targetId = String(req.params.id);
    if (!Types.ObjectId.isValid(targetId)) {
      res.status(400).json({ error: "invalid user id" });
      return;
    }

    const target = await UserModel.findById(targetId);
    if (!target) {
      res.status(404).json({ error: "user not found" });
      return;
    }

    const adminCount = await UserModel.countDocuments({ role: "admin" });
    const decision = evaluateRoleChange({
      actorId: req.user!.id,
      targetId,
      targetCurrentRole: target.role,
      requestedRole: role,
      adminCount
    });
    if (!decision.ok) {
      res.status(decision.status).json({ error: decision.error });
      return;
    }
    if (!decision.changed) {
      res.json({ user: { id: String(target._id), email: target.email, role: target.role } });
      return;
    }

    const previousRole = target.role;
    target.role = role;
    await target.save();
    logger.info(
      { actorId: req.user!.id, targetId, previousRole, newRole: role },
      "admin changed user role"
    );

    res.json({ user: { id: String(target._id), email: target.email, role: target.role } });
  } catch (error) {
    next(error);
  }
});

const ACTIVE_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// GET /api/admin/analytics/summary — global headline numbers.
// Computed app-side (not via Cosmos aggregation/distinct, both of which have
// bitten us — see deploy notes). Fine at current volume; revisit with a stored
// aggregate if the session corpus grows large.
adminRouter.get("/analytics/summary", async (_req, res, next) => {
  try {
    const activeCutoff = new Date(Date.now() - ACTIVE_WINDOW_DAYS * DAY_MS);

    const [userCount, meetingCount, activeByLogin] = await Promise.all([
      UserModel.countDocuments({}),
      BotSessionModel.countDocuments({}),
      UserModel.countDocuments({ lastLoginAt: { $gte: activeCutoff } })
    ]);

    // Single pass over sessions: total minutes + activity-based active owners.
    const sessions = await BotSessionModel.find({})
      .select("userId startedAt endedAt createdAt")
      .lean();
    let totalMinutes = 0;
    const activeOwners = new Set<string>();
    for (const s of sessions) {
      if (s.startedAt && s.endedAt) {
        const ms = new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime();
        if (ms > 0) totalMinutes += ms / 60000;
      }
      if (s.userId && s.createdAt && new Date(s.createdAt) >= activeCutoff) {
        activeOwners.add(String(s.userId));
      }
    }

    res.json({
      userCount,
      meetingCount,
      totalMinutes: Math.round(totalMinutes),
      activeWindowDays: ACTIVE_WINDOW_DAYS,
      activeUsers: activeOwners.size, // activity-based: owns a meeting in window
      activeByLogin // login-based: logged in within window (accrues post-deploy)
    });
  } catch (error) {
    next(error);
  }
});

const trendsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30)
});

// UTC day key (YYYY-MM-DD) for bucketing.
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface TrendPoint {
  date: string;
  signups: number;
  meetings: number;
}

// Start of the UTC day `days-1` back from nowMs — the inclusive-of-today window
// start. Exported so the handler can derive the DB cutoff from the same math.
export function trendsWindowStartMs(days: number, nowMs: number): number {
  const todayStart = new Date(`${dayKey(new Date(nowMs))}T00:00:00.000Z`).getTime();
  return todayStart - (days - 1) * DAY_MS;
}

// Pure bucketer: signups/day + meetings/day across `days` UTC days ending today,
// emitting every day (zeros included) so the series is continuous. Separated
// from request/DB plumbing so the date-range/off-by-one logic can be unit-tested.
export function buildTrendSeries(
  userDates: Date[],
  sessionDates: Date[],
  days: number,
  nowMs: number
): TrendPoint[] {
  const startMs = trendsWindowStartMs(days, nowMs);
  const tally = (dates: Date[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const d of dates) {
      const key = dayKey(d);
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  };
  const signups = tally(userDates);
  const meetings = tally(sessionDates);

  const series: TrendPoint[] = [];
  for (let i = 0; i < days; i += 1) {
    const key = dayKey(new Date(startMs + i * DAY_MS));
    series.push({ date: key, signups: signups.get(key) ?? 0, meetings: meetings.get(key) ?? 0 });
  }
  return series;
}

// GET /api/admin/analytics/trends — signups/day + meetings/day for the last N
// days. Bucketed app-side to avoid Cosmos $dateToString aggregation; only the
// timestamps in-window are fetched.
adminRouter.get("/analytics/trends", async (req, res, next) => {
  try {
    const { days } = trendsQuerySchema.parse(req.query);
    const nowMs = Date.now();
    const cutoff = new Date(trendsWindowStartMs(days, nowMs));

    const [users, sessions] = await Promise.all([
      UserModel.find({ createdAt: { $gte: cutoff } }).select("createdAt").lean(),
      BotSessionModel.find({ createdAt: { $gte: cutoff } }).select("createdAt").lean()
    ]);

    const series = buildTrendSeries(
      users.flatMap((u) => (u.createdAt ? [new Date(u.createdAt)] : [])),
      sessions.flatMap((s) => (s.createdAt ? [new Date(s.createdAt)] : [])),
      days,
      nowMs
    );

    res.json({ days, series });
  } catch (error) {
    next(error);
  }
});
