import type { EventSource, RawContractEvent } from './eventSource';
import { computeBackoffDelayMs, type BackoffOptions } from './backoff';
import { type AnyMetricsRegistry, NoopMetricsRegistry } from './metrics';

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
   * Optional metrics registry.  Pass a `MetricsRegistry` instance to record
   * per-phase counters and latency histograms.  When omitted (or when a
   * `NoopMetricsRegistry` is passed) all instrumentation is zero-overhead.
   */
  metrics?: AnyMetricsRegistry;
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
  private readonly metrics: AnyMetricsRegistry;

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
    this.metrics = options.metrics ?? new NoopMetricsRegistry();
  }

  // Soroban RPC's getEvents is a polling/cursor API, not a persistent stream, so
  // "reconnecting" here just means: pause, then poll again with backoff.
  async start(): Promise<void> {
    this.running = true;
    this.attempt = 0;

    while (this.running) {
      let response: { events: RawContractEvent[]; nextCursor: string };
      const pollStart = Date.now();
      try {
        response = await this.eventSource.getEvents(this.cursor);
      } catch (err) {
        const pollDuration = Date.now() - pollStart;
        this.metrics.counter.inc('rpc_poll', 'failure');
        this.metrics.histogram.observe('rpc_poll', pollDuration);

        this.attempt += 1;
        this.logger.warn(
          `horizon-listener: poll failed (attempt ${this.attempt}/${this.maxRetries}), backing off`,
          err,
        );

        if (this.attempt >= this.maxRetries) {
          this.running = false;
          this.metrics.counter.inc('rpc_poll', 'cancelled');
          throw new Error(
            `horizon-listener: giving up after ${this.attempt} consecutive failed polls`,
          );
        }

        const delayMs = computeBackoffDelayMs(this.attempt, this.backoffOptions);
        await this.sleep(delayMs);
        continue;
      }

      const pollDuration = Date.now() - pollStart;
      this.metrics.counter.inc('rpc_poll', 'success');
      this.metrics.histogram.observe('rpc_poll', pollDuration);

      this.attempt = 0;

      for (const event of response.events) {
        const relayStart = Date.now();
        try {
          this.logger.info('horizon-listener: received contract event', event);
          await this.onEvent(event);
          const relayDuration = Date.now() - relayStart;
          this.metrics.counter.inc('event_relay', 'success');
          this.metrics.histogram.observe('event_relay', relayDuration);
        } catch (err) {
          const relayDuration = Date.now() - relayStart;
          this.logger.error('horizon-listener: onEvent handler threw', err);
          this.metrics.counter.inc('event_relay', 'failure');
          this.metrics.histogram.observe('event_relay', relayDuration);
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
