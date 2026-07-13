import { describe, expect, it } from "vitest";
import { adaptBodyForAzure400 } from "../src/ai/azureOpenAI";

// The modern body the client sends first.
const base = () => ({
  messages: [{ role: "user", content: "hi" }],
  temperature: 0.2,
  response_format: { type: "json_object" },
  max_completion_tokens: 900
});

describe("adaptBodyForAzure400", () => {
  it("swaps max_completion_tokens → max_tokens when the deployment rejects it", () => {
    const out = adaptBodyForAzure400(base(), "Unrecognized request argument supplied: max_completion_tokens");
    expect(out).toBeDefined();
    expect(out).not.toHaveProperty("max_completion_tokens");
    expect(out).toMatchObject({ max_tokens: 900 });
    // other params untouched
    expect(out).toHaveProperty("temperature", 0.2);
    expect(out).toHaveProperty("response_format");
  });

  it("drops temperature when a reasoning model rejects a non-default value", () => {
    const out = adaptBodyForAzure400(
      base(),
      "Unsupported value: 'temperature' does not support 0.2 with this model. Only the default (1) value is supported."
    );
    expect(out).toBeDefined();
    expect(out).not.toHaveProperty("temperature");
    // token param + response_format kept
    expect(out).toHaveProperty("max_completion_tokens", 900);
  });

  it("drops response_format when the deployment doesn't support JSON mode", () => {
    const out = adaptBodyForAzure400(base(), "response_format is not supported with this model");
    expect(out).toBeDefined();
    expect(out).not.toHaveProperty("response_format");
  });

  it("swaps max_tokens → max_completion_tokens for a reasoning model", () => {
    const body = { messages: [], max_tokens: 500 };
    const out = adaptBodyForAzure400(body, "Use 'max_completion_tokens' instead; 'max_tokens' is not supported");
    expect(out).toMatchObject({ max_completion_tokens: 500 });
    expect(out).not.toHaveProperty("max_tokens");
  });

  it("returns undefined for a 400 that is not a known parameter mismatch (so it is not retried)", () => {
    expect(adaptBodyForAzure400(base(), "content management policy violation")).toBeUndefined();
    expect(adaptBodyForAzure400(base(), "invalid api key")).toBeUndefined();
  });

  it("adapts multiple offending params named in one error in a single pass", () => {
    const out = adaptBodyForAzure400(base(), "Unsupported: temperature and response_format are not allowed");
    expect(out).toBeDefined();
    expect(out).not.toHaveProperty("temperature");
    expect(out).not.toHaveProperty("response_format");
  });
});
