import { describe, expect, it } from "vitest";
import { buildRosterNameSet, isRosterNameCaption } from "../src/processing/captions";

describe("isRosterNameCaption — roster nameplate rejection", () => {
  // The real poison from meeting 2c811b56: live captions were off, so the Teams
  // scraper stored rows whose text was a participant's full name every ~60s.
  const roster = buildRosterNameSet(["Ashok", "Krunal", "Vraj"]);

  it("drops a caption whose text is a participant full name (first name in roster)", () => {
    expect(isRosterNameCaption("Krunal Panchal", roster)).toBe(true);
  });

  it("drops a caption whose text is exactly a roster name", () => {
    expect(isRosterNameCaption("Ashok", roster)).toBe(true);
  });

  it("keeps real speech that carries sentence punctuation", () => {
    expect(isRosterNameCaption("સંભળાય છે?", roster)).toBe(false);
    expect(isRosterNameCaption("હા સર.", roster)).toBe(false);
    expect(isRosterNameCaption("Ashok, can you hear me?", roster)).toBe(false);
  });

  it("keeps a longer line even without punctuation (real speech, not a nameplate)", () => {
    expect(isRosterNameCaption("okay let us start the demo", roster)).toBe(false);
  });

  it("never drops anything when the roster is empty", () => {
    const empty = buildRosterNameSet([]);
    expect(isRosterNameCaption("Krunal Panchal", empty)).toBe(false);
  });

  it("keeps a bare word that is NOT a known participant name", () => {
    expect(isRosterNameCaption("Pankaj", roster)).toBe(false);
  });
});
