import { createHmac } from 'node:crypto';
import { computeBackoffDelayMs } from './backoff';
import type { RawContractEvent } from './eventSource';
import { type AnyMetricsRegistry, NoopMetricsRegistry } from './metrics';

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
  timeoutMs?: number;
  maxRetries?: number;
  /**
   * Optional metrics registry.  Pass a `MetricsRegistry` instance to record
   * per-call counters and latency histograms for the `webhook` phase.
   * Defaults to a no-op registry — zero overhead when omitted.
   */
  metrics?: AnyMetricsRegistry;
}

export class HttpWebhookSender implements WebhookSender {
  private readonly url: string;
  private readonly signingSecret?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number | undefined;
  private readonly maxRetries: number;
  private readonly metrics: AnyMetricsRegistry;

  constructor(options: HttpWebhookSenderOptions) {
    this.url = options.url;
    this.signingSecret = options.signingSecret;
    // Node 20+ ships a global fetch; fetchImpl is injectable so tests never
    // make a real network call.
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs;
    this.maxRetries = options.maxRetries ?? 3;
    this.metrics = options.metrics ?? new NoopMetricsRegistry();
  }

  /**
   * Sends an event to the configured webhook URL.
   * @throws {Error} When the HTTP response is not OK (status >= 400).
   * Consumers should handle this error with retry logic or fallback behavior.
   */
  async send(event: RawContractEvent): Promise<void> {
    const body = JSON.stringify({ event });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (this.signingSecret) {
      headers['X-Signature'] = `sha256=${this.sign(body)}`;
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delayMs = computeBackoffDelayMs(attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      const start = Date.now();
      try {
        const controller = this.timeoutMs ? new AbortController() : undefined;
        let timeoutHandle: NodeJS.Timeout | undefined;

        try {
          if (controller && this.timeoutMs) {
            timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);
          }

          const response = await this.fetchImpl(this.url, {
            method: 'POST',
            headers,
            body,
            signal: controller?.signal,
          });

          const durationMs = Date.now() - start;

          if (!response.ok) {
            this.metrics.counter.inc('webhook', 'failure');
            this.metrics.histogram.observe('webhook', durationMs);
            throw new Error(
              `horizon-listener: webhook POST to ${this.url} failed with status ${response.status}`,
            );
          }

          this.metrics.counter.inc('webhook', 'success');
          this.metrics.histogram.observe('webhook', durationMs);
          return;
        } finally {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
        }
      } catch (error) {
        if (!(error instanceof Error && error.message.includes('failed with status'))) {
          const durationMs = Date.now() - start;
          this.metrics.counter.inc('webhook', 'failure');
          this.metrics.histogram.observe('webhook', durationMs);
        }
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt === this.maxRetries) {
          throw lastError;
        }
      }
    }
  }

  private sign(body: string): string {
    return createHmac('sha256', this.signingSecret!).update(body).digest('hex');
  }
}
