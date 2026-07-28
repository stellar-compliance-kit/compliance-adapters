import type { RawContractEvent } from './eventSource';

export interface WebhookSender {
  send(event: RawContractEvent): Promise<void>;
}

export interface HttpWebhookSenderOptions {
  url: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class HttpWebhookSender implements WebhookSender {
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number | undefined;

  constructor(options: HttpWebhookSenderOptions) {
    this.url = options.url;
    // Node 20+ ships a global fetch; fetchImpl is injectable so tests never
    // make a real network call.
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs;
  }

  async send(event: RawContractEvent): Promise<void> {
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
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}
