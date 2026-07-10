import { describe, expect, it } from "vitest";
import { countScripts, detectMeetingLanguage, indicScriptFraction } from "../src/transcription/languageDetection";

describe("countScripts / indicScriptFraction", () => {
  it("counts latin, devanagari and gujarati letters", () => {
    const counts = countScripts("hi કેમ कैसे");
    expect(counts.latin).toBe(2);
    expect(counts.gujarati).toBeGreaterThan(0);
    expect(counts.devanagari).toBeGreaterThan(0);
  });

  it("is 0 for pure English and high for pure Indic", () => {
    expect(indicScriptFraction("hello there everyone")).toBe(0);
    expect(indicScriptFraction("કેમ છો બધા")).toBeGreaterThan(0.9);
  });
});

describe("detectMeetingLanguage", () => {
  it("classifies English", () => {
    const detection = detectMeetingLanguage("Today's deployment has been completed");
    expect(detection.meetingLanguage).toBe("en");
    expect(detection.isEnglish).toBe(true);
  });

  it("classifies Gujarati", () => {
    const detection = detectMeetingLanguage("કેમ છો બધા આજે મજામાં");
    expect(detection.meetingLanguage).toBe("gu");
    expect(detection.isEnglish).toBe(false);
  });

  it("classifies Hindi", () => {
    const detection = detectMeetingLanguage("कल का डिप्लॉयमेंट सफल रहा");
    expect(detection.meetingLanguage).toBe("hi");
  });

  it("classifies code-mixed as mixed", () => {
    const detection = detectMeetingLanguage("આજે backend ma issue હતો but solve થઈ ગયો");
    expect(detection.meetingLanguage).toBe("mixed");
    expect(detection.languages).toContain("en");
    expect(detection.languages).toContain("gu");
  });

  it("falls back to the Whisper label when there is no analysable text", () => {
    const detection = detectMeetingLanguage("12:30 — 45%", "hi");
    expect(detection.meetingLanguage).toBe("hi");
  });
});
