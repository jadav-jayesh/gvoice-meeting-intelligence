import { describe, expect, it } from "vitest";
import { evaluateJoin } from "../src/services/calendar/calendarAutoJoinService";

// Fixed "now" and the prod-ish timing: 60s poll interval, 90s lead, 2min grace.
const NOW = 1_700_000_000_000;
const LEAD = 90_000;
const HORIZON = 60_000 + 90_000; // CALENDAR_SYNC_INTERVAL_MS(60s) + 90s buffer
const GRACE = 120_000;
const MIN = 60_000;

function evalAt(startOffsetMs: number, durationMs = 30 * MIN) {
  return evaluateJoin({
    startMs: NOW + startOffsetMs,
    endMs: NOW + startOffsetMs + durationMs,
    now: NOW,
    leadMs: LEAD,
    horizonMs: HORIZON,
    graceMs: GRACE
  });
}

describe("evaluateJoin", () => {
  it("schedules an upcoming meeting within the horizon", () => {
    // starts in 2 min → join-time in 30s
    const r = evalAt(2 * MIN);
    expect(r.schedule).toBe(true);
    expect(r.delayMs).toBe(2 * MIN - LEAD); // 30s
  });

  it("fires immediately when the join-time is already here (start - lead = now)", () => {
    const r = evalAt(LEAD); // starts in 90s → join now
    expect(r.schedule).toBe(true);
    expect(r.delayMs).toBe(0);
  });

  it("waits (does not schedule) for far-future meetings beyond the horizon", () => {
    const r = evalAt(30 * MIN);
    expect(r.schedule).toBe(false);
  });

  it("joins an instant 'meet now' meeting (start == now, ongoing) immediately", () => {
    const r = evalAt(0);
    expect(r.schedule).toBe(true);
    expect(r.delayMs).toBe(0);
  });

  it("joins a meeting that already started (missed pre-start window) while still ongoing", () => {
    // started 3 min ago, still running — old logic skipped this (past grace);
    // new in-progress rule joins it late.
    const r = evalAt(-3 * MIN);
    expect(r.schedule).toBe(true);
    expect(r.delayMs).toBe(0);
  });

  it("does NOT join a meeting that has already ended", () => {
    // started 31 min ago, ended 1 min ago
    const r = evaluateJoin({
      startMs: NOW - 31 * MIN,
      endMs: NOW - 1 * MIN,
      now: NOW,
      leadMs: LEAD,
      horizonMs: HORIZON,
      graceMs: GRACE
    });
    expect(r.schedule).toBe(false);
  });

  it("ignores meetings with an unparseable start time", () => {
    const r = evaluateJoin({
      startMs: Number.NaN,
      endMs: Number.NaN,
      now: NOW,
      leadMs: LEAD,
      horizonMs: HORIZON,
      graceMs: GRACE
    });
    expect(r.schedule).toBe(false);
  });

  it("still honors the lead-time grace for a meeting that just started (no end overlap)", () => {
    // start == now, zero-length window → not 'ongoing', but join-time (now-lead)
    // is within grace, so it's still an upcoming join firing immediately.
    const r = evaluateJoin({
      startMs: NOW,
      endMs: NOW,
      now: NOW,
      leadMs: LEAD,
      horizonMs: HORIZON,
      graceMs: GRACE
    });
    expect(r.schedule).toBe(true);
    expect(r.delayMs).toBe(0);
  });
});
