import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tests are pure-function unit tests over the Whisper/Pyannote pipeline;
    // no global setup or network access is required.
    globals: false
  }
});
