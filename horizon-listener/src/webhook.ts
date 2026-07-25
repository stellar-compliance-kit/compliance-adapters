import { createHmac } from 'node:crypto';
import type { RawContractEvent } from './eventSource';

export interface WebhookSender {
  send(event: RawContractEvent): Promise<void>;
}

export interface HttpWebhookSenderOptions {
  url: string;
  /**
   * Shared secret used to sign outbound requests. When set, every request
   * carries an `X-Signature` header (`sha256=<hex hmac>`) computed over the
   * raw request body so receivers can verify the request came from this
   * sender. See horizon-listener/README.md for the verification recipe.
   */
  signingSecret?: string;
  fetchImpl?: typeof fetch;
}

export class HttpWebhookSender implements WebhookSender {
  private readonly url: string;
  private readonly signingSecret?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpWebhookSenderOptions) {
    this.url = options.url;
    this.signingSecret = options.signingSecret;
    // Node 20+ ships a global fetch; fetchImpl is injectable so tests never
    // make a real network call.
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(event: RawContractEvent): Promise<void> {
    const body = JSON.stringify({ event });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (this.signingSecret) {
      headers['X-Signature'] = `sha256=${this.sign(body)}`;
    }

    const response = await this.fetchImpl(this.url, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      throw new Error(
        `horizon-listener: webhook POST to ${this.url} failed with status ${response.status}`,
      );
    }
  }

  private sign(body: string): string {
    return createHmac('sha256', this.signingSecret!).update(body).digest('hex');
  }
}
