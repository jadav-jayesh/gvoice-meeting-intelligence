import { describe, expect, it } from "vitest";
import { instanceKey } from "../src/services/calendar/calendarAutoJoinService";
import { isBotStillLive } from "../src/routes/bots";

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

describe("instanceKey (cross-user calendar dedup)", () => {
  it("two users invited to the SAME meeting produce the SAME key (no userId)", () => {
    const url = "https://meet.google.com/abc-defg-hij";
    const start = Date.parse("2026-06-23T10:00:00.000Z");
    // Same link + same start, regardless of which user's poll computes it.
    expect(instanceKey(url, start)).toBe(instanceKey(url, start));
  });

  it("normalizes trivially-different URLs (query/trailing slash) to one key", () => {
    const start = Date.parse("2026-06-23T10:00:00.000Z");
    expect(instanceKey("https://meet.google.com/abc-defg-hij?authuser=0", start)).toBe(
      instanceKey("https://meet.google.com/abc-defg-hij/", start)
    );
  });

  it("a DIFFERENT start (recurring link, later occurrence) yields a different key", () => {
    const url = "https://meet.google.com/abc-defg-hij";
    expect(instanceKey(url, Date.parse("2026-06-23T10:00:00Z"))).not.toBe(
      instanceKey(url, Date.parse("2026-06-24T10:00:00Z"))
    );
  });

  it("a different meeting link yields a different key", () => {
    const start = Date.parse("2026-06-23T10:00:00Z");
    expect(instanceKey("https://meet.google.com/aaa-aaaa-aaa", start)).not.toBe(
      instanceKey("https://meet.google.com/bbb-bbbb-bbb", start)
    );
  });
});

describe("isBotStillLive (manual-join attach window)", () => {
  const now = Date.parse("2026-06-23T10:30:00.000Z");

  it("calendar bot: live until scheduled end + grace", () => {
    const end = Date.parse("2026-06-23T10:25:00Z"); // ended 5 min ago
    // within the 15-min grace → still attach
    expect(isBotStillLive({ now, scheduledEndAtMs: end, createdAtMs: now - HOUR })).toBe(true);
  });

  it("calendar bot: NOT live once past scheduled end + grace", () => {
    const end = Date.parse("2026-06-23T10:10:00Z"); // ended 20 min ago (> 15m grace)
    expect(isBotStillLive({ now, scheduledEndAtMs: end, createdAtMs: now - HOUR })).toBe(false);
  });

  it("manual bot (no end): live within the 6h recency window", () => {
    expect(isBotStillLive({ now, createdAtMs: now - 2 * HOUR })).toBe(true);
  });

  it("manual bot (no end): NOT live once older than 6h (recurring-link zombie)", () => {
    expect(isBotStillLive({ now, createdAtMs: now - 7 * HOUR })).toBe(false);
  });

  it("scheduled end takes precedence over the recency net", () => {
    // created seconds ago but the scheduled meeting already ended long past grace
    const end = Date.parse("2026-06-23T09:00:00Z"); // 90 min ago
    expect(isBotStillLive({ now, scheduledEndAtMs: end, createdAtMs: now - 1 * MIN })).toBe(false);
  });
});
