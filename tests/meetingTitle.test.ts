import { describe, expect, it } from "vitest";
import { resolveMeetingName } from "../src/services/meetingTitle";

describe("resolveMeetingName", () => {
  it("prefers the provider subject (Teams/Zoom) above all", () => {
    expect(
      resolveMeetingName({
        providerSubject: "Q3 Planning",
        scheduledTitle: "Calendar Title",
        aiShortTitle: "AI Generated Title"
      })
    ).toBe("Q3 Planning");
  });

  it("falls back to the calendar title when no provider subject (the Teams bug)", () => {
    // Teams onlineMeeting.subject comes back empty → must use the calendar
    // title, NOT the AI-generated one.
    expect(
      resolveMeetingName({
        providerSubject: "",
        scheduledTitle: "Daily Standup",
        aiShortTitle: "Bot Integration Testing"
      })
    ).toBe("Daily Standup");
  });

  it("uses the calendar title for Meet/Zoom when there's no provider subject", () => {
    expect(
      resolveMeetingName({
        scheduledTitle: "gVoice Prod Meet",
        aiShortTitle: "Product Strategy Discussion"
      })
    ).toBe("gVoice Prod Meet");
  });

  it("uses the AI short title only when nothing real exists (manual join)", () => {
    expect(resolveMeetingName({ aiShortTitle: "Sprint Retrospective" })).toBe("Sprint Retrospective");
  });

  it("treats whitespace-only sources as empty and skips them", () => {
    expect(
      resolveMeetingName({
        providerSubject: "   ",
        scheduledTitle: "   ",
        aiShortTitle: "Fallback Title"
      })
    ).toBe("Fallback Title");
  });

  it("returns undefined when no source has a value (leave meetingName untouched)", () => {
    expect(resolveMeetingName({})).toBeUndefined();
    expect(resolveMeetingName({ providerSubject: "", scheduledTitle: "", aiShortTitle: "" })).toBeUndefined();
  });

  it("trims the chosen value", () => {
    expect(resolveMeetingName({ scheduledTitle: "  Weekly Sync  " })).toBe("Weekly Sync");
  });
});
