import { env } from "../config/env";
import { cfgString } from "../config/runtimeConfig";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class AzureOpenAIClient {
  assertChatConfigured(): void {
    if (!cfgString("AZURE_OPENAI_API_KEY")) {
      throw new Error("Azure OpenAI chat is not configured. Set AZURE_OPENAI_API_KEY.");
    }

    if (!env.AZURE_OPENAI_SUMMARY_ENDPOINT && (!env.AZURE_OPENAI_ENDPOINT || !env.AZURE_OPENAI_CHAT_DEPLOYMENT)) {
      throw new Error(
        "Azure OpenAI chat is not configured. Set AZURE_OPENAI_SUMMARY_ENDPOINT, or set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_CHAT_DEPLOYMENT."
      );
    }
  }

  assertTranscriptionConfigured(): void {
    if (
      !cfgString("AZURE_OPENAI_API_KEY") ||
      (!env.AZURE_OPENAI_TRANSCRIPTION_ENDPOINT && (!env.AZURE_OPENAI_ENDPOINT || !env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT))
    ) {
      throw new Error(
        "Azure OpenAI transcription is not configured. Set AZURE_OPENAI_TRANSCRIPTION_ENDPOINT, or set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT."
      );
    }
  }

  isTranscriptionConfigured(): boolean {
    return Boolean(
      cfgString("AZURE_OPENAI_API_KEY") &&
        (env.AZURE_OPENAI_TRANSCRIPTION_ENDPOINT || (env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT))
    );
  }

  isChatConfigured(): boolean {
    return Boolean(
      cfgString("AZURE_OPENAI_API_KEY") &&
        (env.AZURE_OPENAI_SUMMARY_ENDPOINT || (env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_CHAT_DEPLOYMENT))
    );
  }

  async chatJson<T>(
    messages: ChatMessage[],
    fallbackLabel: string,
    options: { maxCompletionTokens?: number } = {}
  ): Promise<T> {
    this.assertChatConfigured();
    const url = env.AZURE_OPENAI_SUMMARY_ENDPOINT ?? this.deploymentUrl(env.AZURE_OPENAI_CHAT_DEPLOYMENT as string, "chat/completions");
    // gpt-5 / reasoning deployments spend reasoning tokens out of this same
    // budget before emitting any output — too small a cap yields an empty
    // message (no content) rather than a short answer. 900 was enough for
    // legacy chat models but starves reasoning models, so default higher.
    const maxCompletionTokens = options.maxCompletionTokens ?? 4000;

    // Deployments disagree on the request shape: reasoning models (o1/o3/gpt-5*)
    // reject any non-default `temperature`; older / non-o1 deployments reject
    // `max_completion_tokens` and want `max_tokens`; some reject `response_format`.
    // Start with the modern shape and, on a 400 that names an unsupported
    // parameter, adapt the body and retry — so one client works across every
    // deployment instead of silently falling back to a canned summary.
    let body: Record<string, unknown> = {
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" },
      max_completion_tokens: maxCompletionTokens
    };

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.postJsonWithRetry(url, body);
      if (response.ok) {
        return parseChatJson(await readAzureResponse(response), fallbackLabel);
      }

      const errorText = await response.text();
      const adapted = response.status === 400 ? adaptBodyForAzure400(body, errorText) : undefined;
      if (!adapted) {
        throw new Error(`Azure OpenAI request failed with ${response.status}: ${errorText}`);
      }
      body = adapted;
    }

    throw new Error(`Azure OpenAI ${fallbackLabel} request failed: no parameter shape accepted by the deployment`);
  }

  async transcribeAudio(audioPath: string): Promise<unknown> {
    this.assertTranscriptionConfigured();
    const file = await filePart(audioPath, "audio/wav");
    const form = new FormData();
    form.append("file", file, "audio.wav");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");

    const url = env.AZURE_OPENAI_TRANSCRIPTION_ENDPOINT ?? this.deploymentUrl(env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT as string, "audio/transcriptions");
    const response = await this.fetchWithRetry(() =>
      fetch(url, {
        method: "POST",
        headers: {
          "api-key": cfgString("AZURE_OPENAI_API_KEY") as string
        },
        body: form,
        signal: AbortSignal.timeout(env.AZURE_OPENAI_SUMMARY_TIMEOUT_MS)
      })
    );

    return readAzureResponse(response);
  }

  private deploymentUrl(deployment: string, operation: string): string {
    const base = env.AZURE_OPENAI_ENDPOINT?.replace(/\/+$/g, "");
    return `${base}/openai/deployments/${encodeURIComponent(deployment)}/${operation}?api-version=${encodeURIComponent(env.AZURE_OPENAI_API_VERSION)}`;
  }

  private postJsonWithRetry(url: string, body: unknown): Promise<Response> {
    return this.fetchWithRetry(() =>
      fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "api-key": cfgString("AZURE_OPENAI_API_KEY") as string
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(env.AZURE_OPENAI_SUMMARY_TIMEOUT_MS)
      })
    );
  }

  private async fetchWithRetry(request: () => Promise<Response>): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= env.AZURE_OPENAI_RETRY_ATTEMPTS; attempt += 1) {
      try {
        const response = await request();
        if (!isRetryableAzureStatus(response.status) || attempt >= env.AZURE_OPENAI_RETRY_ATTEMPTS) {
          return response;
        }

        await delay(azureRetryDelayMs(response, attempt));
      } catch (error) {
        lastError = error;
        if (attempt >= env.AZURE_OPENAI_RETRY_ATTEMPTS || !isRetryableAzureError(error)) {
          throw error;
        }

        await delay(env.AZURE_OPENAI_RETRY_DELAY_MS * 2 ** (attempt - 1));
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

async function filePart(filePath: string, type: string): Promise<Blob> {
  const { readFile } = await import("node:fs/promises");
  const buffer = await readFile(filePath);
  return new Blob([new Uint8Array(buffer)], { type });
}

async function readAzureResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Azure OpenAI request failed with ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

// On a 400 that names an unsupported parameter, return an adapted body so the
// next attempt matches what the deployment accepts. Returns undefined when the
// error is not a known parameter mismatch (nothing worth retrying).
export function adaptBodyForAzure400(body: Record<string, unknown>, errorText: string): Record<string, unknown> | undefined {
  const message = errorText.toLocaleLowerCase("en-US");
  const next: Record<string, unknown> = { ...body };
  let changed = false;

  // Token-limit parameter: reasoning models want `max_completion_tokens`; older
  // deployments want `max_tokens`. Swap to the form the error is not rejecting.
  if (message.includes("max_completion_tokens") && "max_completion_tokens" in next) {
    next.max_tokens = next.max_completion_tokens;
    delete next.max_completion_tokens;
    changed = true;
  } else if (message.includes("max_tokens") && "max_tokens" in next) {
    next.max_completion_tokens = next.max_tokens;
    delete next.max_tokens;
    changed = true;
  }

  // Reasoning models only allow the default temperature (1) — drop ours.
  if (message.includes("temperature") && "temperature" in next) {
    delete next.temperature;
    changed = true;
  }

  // Some deployments / api-versions don't support JSON response_format.
  if (message.includes("response_format") && "response_format" in next) {
    delete next.response_format;
    changed = true;
  }

  return changed ? next : undefined;
}

function isRetryableAzureStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isRetryableAzureError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLocaleLowerCase("en-US") : String(error).toLocaleLowerCase("en-US");
  return (
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("socket hang up") ||
    message.includes("network") ||
    message.includes("timeout")
  );
}

function azureRetryDelayMs(response: Response, attempt: number): number {
  const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after-ms"));
  if (retryAfterMs !== undefined) return retryAfterMs;

  const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("retry-after"));
  if (retryAfterSeconds !== undefined) return retryAfterSeconds * 1000;

  return env.AZURE_OPENAI_RETRY_DELAY_MS * 2 ** (attempt - 1);
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 120000) : undefined;
}

function parseRetryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return Math.min(numeric, 120);

  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(1, Math.min(120, Math.ceil((date - Date.now()) / 1000)));
  return undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseChatJson<T>(payload: unknown, fallbackLabel: string): T {
  const content = extractChatContent(payload);
  if (!content) throw new Error(`Azure OpenAI ${fallbackLabel} response did not contain message content`);

  try {
    return JSON.parse(content) as T;
  } catch {
    // Strip prose / markdown fences the model occasionally leaks in.
    const jsonBlock = content.match(/\{[\s\S]*\}/);
    if (jsonBlock) {
      try {
        return JSON.parse(jsonBlock[0]) as T;
      } catch {
        // fall through to repair pass below
      }
    }

    // Last-resort: the response is structurally fine but got truncated by the
    // token cap (a common shape: open arrays/objects and a half-written
    // string). Close the dangling brackets so the partial result still
    // validates downstream.
    const repaired = repairTruncatedJson(jsonBlock?.[0] ?? content);
    if (repaired) {
      try {
        return JSON.parse(repaired) as T;
      } catch {
        // fall through to throw
      }
    }
    throw new Error(`Azure OpenAI ${fallbackLabel} response was not valid JSON`);
  }
}

function repairTruncatedJson(raw: string): string | undefined {
  if (!raw) return undefined;
  // Walk the string once, tracking string/escape state and the bracket stack.
  // When we reach the end mid-token, close strings and bracket stack in order.
  let inString = false;
  let escape = false;
  const stack: string[] = [];
  let lastCommaOrColonAt = -1;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (inString) {
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
      continue;
    }
    if (ch === "}" || ch === "]") {
      stack.pop();
      continue;
    }
    if (ch === "," || ch === ":") {
      lastCommaOrColonAt = i;
    }
  }

  let out = raw;
  if (inString) out += '"';
  // After closing the dangling string we might be left with a trailing
  // "key": "value" or value followed by a comma — strip a hanging comma.
  if (!inString && lastCommaOrColonAt === out.length - 1) {
    out = out.slice(0, -1);
  }
  // Drop any trailing comma right before we close brackets.
  out = out.replace(/,\s*$/g, "");
  while (stack.length > 0) {
    const opener = stack.pop();
    out += opener === "{" ? "}" : "]";
  }
  return out;
}

function extractChatContent(payload: unknown): string | undefined {
  const response = payload as { choices?: Array<{ message?: { content?: string } }> };
  return response.choices?.[0]?.message?.content;
}
