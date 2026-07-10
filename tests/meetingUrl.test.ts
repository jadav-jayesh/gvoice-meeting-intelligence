import { describe, expect, it } from "vitest";
import { detectPlatformFromUrl, extractMeetingUrl, meetingDedupeKey } from "../src/utils/meetingUrl";

describe("detectPlatformFromUrl", () => {
  it("recognizes each platform by host", () => {
    expect(detectPlatformFromUrl("https://meet.google.com/abc-defg-hij")).toBe("google_meet");
    expect(detectPlatformFromUrl("https://teams.microsoft.com/l/meetup-join/19%3ameeting_x")).toBe("microsoft_teams");
    expect(detectPlatformFromUrl("https://us02web.zoom.us/j/8412345678?pwd=AbC")).toBe("zoom");
    expect(detectPlatformFromUrl("https://company.zoom.us/j/99")).toBe("zoom");
  });

  it("returns undefined for non-meeting and malformed URLs", () => {
    expect(detectPlatformFromUrl("https://example.com/page")).toBeUndefined();
    expect(detectPlatformFromUrl("not a url")).toBeUndefined();
    expect(detectPlatformFromUrl("")).toBeUndefined();
  });
});

describe("extractMeetingUrl", () => {
  it("pulls the first meeting link out of free text", () => {
    const body = "Join here: https://meet.google.com/abc-defg-hij or dial in.";
    expect(extractMeetingUrl(body)).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("trims trailing punctuation and skips non-meeting links", () => {
    const body = "Docs at https://example.com/x. Call: https://us02web.zoom.us/j/123?pwd=xy).";
    expect(extractMeetingUrl(body)).toBe("https://us02web.zoom.us/j/123?pwd=xy");
  });

  it("returns undefined when there is no meeting link", () => {
    expect(extractMeetingUrl("no links here")).toBeUndefined();
    expect(extractMeetingUrl(undefined)).toBeUndefined();
  });
});

describe("meetingDedupeKey", () => {
  it("collapses the same meeting across query/fragment noise", () => {
    const a = meetingDedupeKey("https://meet.google.com/abc-defg-hij?authuser=0");
    const b = meetingDedupeKey("https://meet.google.com/abc-defg-hij#start");
    expect(a).toBe(b);
    expect(a).toBe("meet.google.com/abc-defg-hij");
  });

  it("keeps the Zoom passcode in the key", () => {
    expect(meetingDedupeKey("https://us02web.zoom.us/j/123?pwd=SECRET&x=1")).toBe("us02web.zoom.us/j/123?pwd=SECRET");
  });
});
