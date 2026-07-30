import type { EventSource, RawContractEvent } from './eventSource';
import { computeBackoffDelayMs, type BackoffOptions } from './backoff';

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
  // When set, the listener pages through all historical events from this ledger
  // before entering normal live polling. Each page is consumed immediately
  // (without sleeping pollIntervalMs between pages); the listener only switches
  // to interval-based polling once a page returns zero events.
  startLedger?: number;
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

  private cursor: string | undefined;
  private running = false;
  private attempt = 0;
  private backfilling = false;

  constructor(options: HorizonListenerOptions) {
    this.eventSource = options.eventSource;
    this.onEvent = options.onEvent;
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;
    this.maxRetries = options.maxRetries ?? 10;
    this.logger = options.logger ?? consoleLogger;
    this.sleep = options.sleep ?? defaultSleep;
    this.backoffOptions = options.backoffOptions ?? {};
    this.backfilling = options.startLedger != null;
  }

  // Soroban RPC's getEvents is a polling/cursor API, not a persistent stream, so
  // "reconnecting" here just means: pause, then poll again with backoff.
  async start(): Promise<void> {
    this.running = true;
    this.attempt = 0;

    while (this.running) {
      let response: { events: RawContractEvent[]; nextCursor: string };
      try {
        response = await this.eventSource.getEvents(this.cursor);
      } catch (err) {
        this.attempt += 1;
        this.logger.warn(
          `horizon-listener: poll failed (attempt ${this.attempt}/${this.maxRetries}), backing off`,
          err,
        );

        if (this.attempt >= this.maxRetries) {
          this.running = false;
          throw new Error(
            `horizon-listener: giving up after ${this.attempt} consecutive failed polls`,
          );
        }

        const delayMs = computeBackoffDelayMs(this.attempt, this.backoffOptions);
        await this.sleep(delayMs);
        continue;
      }

      this.attempt = 0;

      for (const event of response.events) {
        try {
          this.logger.info('horizon-listener: received contract event', event);
          await this.onEvent(event);
        } catch (err) {
          this.logger.error('horizon-listener: onEvent handler threw', err);
        }
      }

      this.cursor = response.nextCursor;
      this.logger.debug('horizon-listener: cursor advanced', this.cursor);

      if (this.backfilling) {
        if (response.events.length === 0) {
          this.backfilling = false;
          this.logger.info('horizon-listener: backfill complete, switching to live polling');
        } else {
          this.logger.debug(
            `horizon-listener: backfill page consumed (${response.events.length} events), fetching next page`,
          );
          continue;
        }
      }

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
