import type { EventSource, RawContractEvent } from './eventSource';
import { computeBackoffDelayMs, type BackoffOptions } from './backoff';
import { type AnyTracer, NoopTracer } from './tracing';

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

const consoleLogger: Logger = {
  debug: (...args: unknown[]) => console.debug(...args),
  info: (...args: unknown[]) => console.info(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};

export interface HorizonListenerOptions {
  eventSource: EventSource;
  onEvent: (event: RawContractEvent) => Promise<void> | void;
  pollIntervalMs?: number;
  maxRetries?: number;
  logger?: Logger;
  // Injectable so tests can drive time with Jest fake timers instead of waiting
  // on the real wall clock.
  sleep?: (ms: number) => Promise<void>;
  // Injectable so tests can force deterministic (or jitter-free) backoff delays
  // instead of depending on Math.random.
  backoffOptions?: BackoffOptions;
  /**
   * Optional tracer for OpenTelemetry-compatible distributed tracing.
   * When omitted, a no-op tracer is used — zero overhead and no exports.
   *
   * To enable tracing, pass a \`DefaultTracer\` configured with an exporter:
   * \`\`\`ts
   * import { DefaultTracer } from 'horizon-listener';
   * const tracer = new DefaultTracer({
   *   serviceName: 'horizon-listener',
   *   exporter: async (span) => { await otlpExporter.export(span); },
   * });
   * \`\`\`
   */
  tracer?: AnyTracer;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class HorizonListener {
  private readonly eventSource: EventSource;
  private readonly onEvent: (event: RawContractEvent) => Promise<void> | void;
  private readonly pollIntervalMs: number;
  private readonly maxRetries: number;
  private readonly logger: Logger;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly backoffOptions: BackoffOptions;
  private readonly tracer: AnyTracer;

  private cursor: string | undefined;
  private running = false;
  private attempt = 0;

  constructor(options: HorizonListenerOptions) {
    this.eventSource = options.eventSource;
    this.onEvent = options.onEvent;
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;
    this.maxRetries = options.maxRetries ?? 10;
    this.logger = options.logger ?? consoleLogger;
    this.sleep = options.sleep ?? defaultSleep;
    this.backoffOptions = options.backoffOptions ?? {};
    this.tracer = options.tracer ?? new NoopTracer();
  }

  // Soroban RPC's getEvents is a polling/cursor API, not a persistent stream, so
  // "reconnecting" here just means: pause, then poll again with backoff.
  async start(): Promise<void> {
    this.running = true;
    this.attempt = 0;

    while (this.running) {
      // ── rpc_poll span ────────────────────────────────────────────────────
      const pollSpan = this.tracer.startSpan('rpc_poll');
      pollSpan.setAttribute('poll.attempt', this.attempt);

      let response: { events: RawContractEvent[]; nextCursor: string };
      try {
        response = await this.eventSource.getEvents(this.cursor);
      } catch (err) {
        this.attempt += 1;
        pollSpan.setAttribute('poll.attempt', this.attempt);
        pollSpan.end('error', err instanceof Error ? err : new Error(String(err)));

        this.logger.warn(
          `horizon-listener: poll failed (attempt ${this.attempt}/${this.maxRetries}), backing off`,
          err,
        );

        if (this.attempt >= this.maxRetries) {
          this.running = false;
          // Mark the final poll as cancelled (we gave up, not a transient error)
          this.tracer.startSpan('rpc_poll').end('cancelled');
          throw new Error(
            `horizon-listener: giving up after ${this.attempt} consecutive failed polls`,
          );
        }

        const delayMs = computeBackoffDelayMs(this.attempt, this.backoffOptions);
        await this.sleep(delayMs);
        continue;
      }

      pollSpan.setAttribute('poll.event_count', response.events.length);
      pollSpan.end('ok');

      this.attempt = 0;

      for (const event of response.events) {
        // ── event_relay span ───────────────────────────────────────────────
        // Parent is the poll span so spans form a coherent tree:
        // rpc_poll → event_relay (one child per event)
        const relayContext = { traceId: pollSpan.traceId, spanId: pollSpan.spanId };
        const relaySpan = this.tracer.startSpan('event_relay', relayContext);
        // Low-cardinality attributes only — event ID and contract ID are stable
        // identifiers, not user-data payloads. The event value is redacted by
        // the tracer (redactPayload: true by default).
        relaySpan.setAttribute('event.id', event.id);
        relaySpan.setAttribute('event.contract_id', event.contractId);
        relaySpan.setAttribute('event.ledger', event.ledger);

        try {
          this.logger.info('horizon-listener: received contract event', event);
          await this.onEvent(event);
          relaySpan.end('ok');
        } catch (err) {
          this.logger.error('horizon-listener: onEvent handler threw', err);
          relaySpan.end('error', err instanceof Error ? err : new Error(String(err)));
        }
      }

      this.cursor = response.nextCursor;
      this.logger.debug('horizon-listener: cursor advanced', this.cursor);

      if (!this.running) {
        break;
      }

      await this.sleep(this.pollIntervalMs);
    }
  }

  stop(): void {
    this.running = false;
  }
}
