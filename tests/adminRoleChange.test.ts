import { describe, expect, it } from "vitest";
import { evaluateRoleChange, buildTrendSeries } from "../src/routes/admin";

const ACTOR = "actor-id";
const OTHER = "other-id";

describe("evaluateRoleChange", () => {
  it("promotes a user to admin", () => {
    const d = evaluateRoleChange({
      actorId: ACTOR,
      targetId: OTHER,
      targetCurrentRole: "user",
      requestedRole: "admin",
      adminCount: 1
    });
    expect(d).toEqual({ ok: true, changed: true });
  });

  it("demotes another admin when other admins remain", () => {
    const d = evaluateRoleChange({
      actorId: ACTOR,
      targetId: OTHER,
      targetCurrentRole: "admin",
      requestedRole: "user",
      adminCount: 2
    });
    expect(d).toEqual({ ok: true, changed: true });
  });

  it("reports a no-op when the role is unchanged", () => {
    const d = evaluateRoleChange({
      actorId: ACTOR,
      targetId: OTHER,
      targetCurrentRole: "user",
      requestedRole: "user",
      adminCount: 1
    });
    expect(d).toEqual({ ok: true, changed: false });
  });

  it("blocks an admin from demoting themselves", () => {
    const d = evaluateRoleChange({
      actorId: ACTOR,
      targetId: ACTOR,
      targetCurrentRole: "admin",
      requestedRole: "user",
      adminCount: 3
    });
    expect(d).toEqual({ ok: false, status: 400, error: "cannot change your own admin role" });
  });

  it("allows acting on yourself when the role doesn't drop admin (no-op self)", () => {
    const d = evaluateRoleChange({
      actorId: ACTOR,
      targetId: ACTOR,
      targetCurrentRole: "admin",
      requestedRole: "admin",
      adminCount: 1
    });
    expect(d).toEqual({ ok: true, changed: false });
  });

  it("blocks demoting the last remaining admin", () => {
    const d = evaluateRoleChange({
      actorId: ACTOR,
      targetId: OTHER,
      targetCurrentRole: "admin",
      requestedRole: "user",
      adminCount: 1
    });
    expect(d).toEqual({ ok: false, status: 400, error: "cannot demote the last admin" });
  });

  it("self-demote guard fires before the last-admin guard (consistent message)", () => {
    // Actor is the last admin demoting themselves — should report the self guard.
    const d = evaluateRoleChange({
      actorId: ACTOR,
      targetId: ACTOR,
      targetCurrentRole: "admin",
      requestedRole: "user",
      adminCount: 1
    });
    expect(d).toEqual({ ok: false, status: 400, error: "cannot change your own admin role" });
  });
});

describe("buildTrendSeries", () => {
  // 2026-06-15T10:00:00Z — a fixed "now" mid-day UTC.
  const NOW = Date.UTC(2026, 5, 15, 10, 0, 0);

  it("emits exactly `days` points ending on today (UTC), inclusive", () => {
    const s = buildTrendSeries([], [], 7, NOW);
    expect(s).toHaveLength(7);
    expect(s[0].date).toBe("2026-06-09");
    expect(s[6].date).toBe("2026-06-15");
  });

  it("fills zero days continuously", () => {
    const s = buildTrendSeries([], [], 3, NOW);
    expect(s).toEqual([
      { date: "2026-06-13", signups: 0, meetings: 0 },
      { date: "2026-06-14", signups: 0, meetings: 0 },
      { date: "2026-06-15", signups: 0, meetings: 0 }
    ]);
  });

  it("buckets signups and meetings into their UTC day", () => {
    const users = [new Date("2026-06-15T01:00:00Z"), new Date("2026-06-15T23:59:00Z"), new Date("2026-06-14T12:00:00Z")];
    const sessions = [new Date("2026-06-14T08:00:00Z")];
    const s = buildTrendSeries(users, sessions, 3, NOW);
    expect(s).toEqual([
      { date: "2026-06-13", signups: 0, meetings: 0 },
      { date: "2026-06-14", signups: 1, meetings: 1 },
      { date: "2026-06-15", signups: 2, meetings: 0 }
    ]);
  });

  it("ignores activity older than the window", () => {
    const users = [new Date("2026-06-01T00:00:00Z")]; // before a 3-day window
    const s = buildTrendSeries(users, [], 3, NOW);
    expect(s.reduce((n, p) => n + p.signups, 0)).toBe(0);
  });
});
