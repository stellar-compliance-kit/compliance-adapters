import type { RawContractEvent } from './eventSource';
import { type AnyTracer, NoopTracer, type TracingContext } from './tracing';

export interface WebhookSender {
  send(event: RawContractEvent): Promise<void>;
}

export interface HttpWebhookSenderOptions {
  url: string;
  fetchImpl?: typeof fetch;
  /**
   * Optional tracer for OpenTelemetry-compatible distributed tracing.
   * When omitted, a no-op tracer is used — zero overhead and no exports.
   *
   * Pass a parent \`TracingContext\` alongside the tracer to nest webhook spans
   * inside an existing trace tree (e.g. a parent \`event_relay\` span).
   */
  tracer?: AnyTracer;
  /** Parent context for outbound webhook spans. */
  parentContext?: TracingContext;
}

export class HttpWebhookSender implements WebhookSender {
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly tracer: AnyTracer;
  private readonly parentContext: TracingContext | undefined;

  constructor(options: HttpWebhookSenderOptions) {
    this.url = options.url;
    // Node 20+ ships a global fetch; fetchImpl is injectable so tests never
    // make a real network call.
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.tracer = options.tracer ?? new NoopTracer();
    this.parentContext = options.parentContext;
  }

  async send(event: RawContractEvent): Promise<void> {
    const span = this.tracer.startSpan('webhook', this.parentContext);
    span.setAttribute('webhook.url', this.url);
    // event.id is a stable, low-cardinality correlation identifier — safe to attach
    span.setAttribute('event.id', event.id);

    // Inject traceparent into outbound request headers for downstream correlation
    const traceparent =
      span.traceId ? this.tracer.injectContext({ traceId: span.traceId, spanId: span.spanId })
      : undefined;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (traceparent) {
      headers['traceparent'] = traceparent;
    }

    try {
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ event }),
      });

      if (!response.ok) {
        span.setAttribute('http.status_code', response.status);
        span.end('error');
        throw new Error(
          `horizon-listener: webhook POST to ${this.url} failed with status ${response.status}`,
        );
      }

      span.setAttribute('http.status_code', response.status);
      span.end('ok');
    } catch (err) {
      // Only end the span here for raw fetch errors (network errors, etc.)
      // that bypass the response.ok check above.
      if (!(err instanceof Error && err.message.includes('failed with status'))) {
        span.end('error', err instanceof Error ? err : new Error(String(err)));
      }
      throw err;
    }
  }
}
