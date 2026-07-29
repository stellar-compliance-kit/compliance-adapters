import type { RawContractEvent } from './eventSource';
import { type AnyMetricsRegistry, NoopMetricsRegistry } from './metrics';

export interface WebhookSender {
  send(event: RawContractEvent): Promise<void>;
}

export interface HttpWebhookSenderOptions {
  url: string;
  fetchImpl?: typeof fetch;
  /**
   * Optional metrics registry.  Pass a `MetricsRegistry` instance to record
   * per-call counters and latency histograms for the `webhook` phase.
   * Defaults to a no-op registry — zero overhead when omitted.
   */
  metrics?: AnyMetricsRegistry;
}

export class HttpWebhookSender implements WebhookSender {
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly metrics: AnyMetricsRegistry;

  constructor(options: HttpWebhookSenderOptions) {
    this.url = options.url;
    // Node 20+ ships a global fetch; fetchImpl is injectable so tests never
    // make a real network call.
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.metrics = options.metrics ?? new NoopMetricsRegistry();
  }

  async send(event: RawContractEvent): Promise<void> {
    const start = Date.now();
    try {
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event }),
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
    } catch (err) {
      // Re-measure in case the error was thrown before the response check
      // (e.g., network error in fetchImpl itself).  The counter was already
      // incremented in the non-ok branch above, so only increment here for
      // raw fetch errors that skip the response check entirely.
      if (!(err instanceof Error && err.message.includes('failed with status'))) {
        const durationMs = Date.now() - start;
        this.metrics.counter.inc('webhook', 'failure');
        this.metrics.histogram.observe('webhook', durationMs);
      }
      throw err;
    }
  }
}
