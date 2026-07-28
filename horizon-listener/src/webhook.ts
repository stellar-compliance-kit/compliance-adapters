import type { RawContractEvent } from './eventSource';

export interface WebhookSender {
  send(event: RawContractEvent): Promise<void>;
}

export interface HttpWebhookSenderOptions {
  url: string;
  fetchImpl?: typeof fetch;
}

export class HttpWebhookSender implements WebhookSender {
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpWebhookSenderOptions) {
    this.url = options.url;
    // Node 20+ ships a global fetch; fetchImpl is injectable so tests never
    // make a real network call.
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Sends an event to the configured webhook URL.
   * @throws {Error} When the HTTP response is not OK (status >= 400).
   * Consumers should handle this error with retry logic or fallback behavior.
   */
  async send(event: RawContractEvent): Promise<void> {
    const response = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event }),
    });

    if (!response.ok) {
      throw new Error(
        `horizon-listener: webhook POST to ${this.url} failed with status ${response.status}`,
      );
    }
  }
}
