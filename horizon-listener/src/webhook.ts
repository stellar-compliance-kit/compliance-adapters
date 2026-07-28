import { computeBackoffDelayMs } from './backoff';
import type { RawContractEvent } from './eventSource';

export interface WebhookSender {
  send(event: RawContractEvent): Promise<void>;
}

export interface HttpWebhookSenderOptions {
  url: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
}

export class HttpWebhookSender implements WebhookSender {
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number | undefined;
  private readonly maxRetries: number;

  constructor(options: HttpWebhookSenderOptions) {
    this.url = options.url;
    // Node 20+ ships a global fetch; fetchImpl is injectable so tests never
    // make a real network call.
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs;
    this.maxRetries = options.maxRetries ?? 3;
  }

  async send(event: RawContractEvent): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delayMs = computeBackoffDelayMs(attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      try {
        const controller = this.timeoutMs ? new AbortController() : undefined;
        let timeoutHandle: NodeJS.Timeout | undefined;

        try {
          if (controller && this.timeoutMs) {
            timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);
          }

          const response = await this.fetchImpl(this.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event }),
            signal: controller?.signal,
          });

          if (!response.ok) {
            throw new Error(
              `horizon-listener: webhook POST to ${this.url} failed with status ${response.status}`,
            );
          }

          return;
        } finally {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt === this.maxRetries) {
          throw lastError;
        }
      }
    }
  }
}
