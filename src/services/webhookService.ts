import type { Participant } from "../types/meeting";
import type { Logger } from "pino";

export class WebhookService {
  constructor(private readonly logger: Logger) {}

  async sendCompleted(webhookUrl: string | undefined, payload: {
    sessionId: string;
    recordingUrl: string;
    duration: number;
    participants: Participant[];
  }): Promise<{ delivered: boolean; skipped: boolean; status?: number; error?: string }> {
    if (!webhookUrl) return { delivered: false, skipped: true };

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "recording.completed",
        ...payload
      })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      this.logger.warn({ status: response.status, body: text }, "completion webhook failed");
      return { delivered: false, skipped: false, status: response.status, error: text };
    }

    this.logger.info({ webhookUrl }, "completion webhook delivered");
    return { delivered: true, skipped: false, status: response.status };
  }
}
