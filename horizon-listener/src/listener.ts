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
  onEventFailure?: (event: RawContractEvent, error: unknown) => void | Promise<void>;
  pollIntervalMs?: number;
  maxRetries?: number;
  logger?: Logger;
  // Injectable so tests can drive time with Jest fake timers instead of waiting
  // on the real wall clock.
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  // Injectable so tests can force deterministic (or jitter-free) backoff delays
  // instead of depending on Math.random.
  backoffOptions?: BackoffOptions;
  // When set, the listener pages through all historical events from this ledger
  // before entering normal live polling. Each page is consumed immediately
  // (without sleeping pollIntervalMs between pages); the listener only switches
  // to interval-based polling once a page returns zero events.
  startLedger?: number;
  // 'poll' (default): fixed-interval polling, always sleeps pollIntervalMs
  // between each call regardless of whether events were returned.
  // 'stream': polls again immediately when events were returned, reducing
  // latency for high-activity contracts; falls back to pollIntervalMs when
  // a poll returns empty (quiet period).
  mode?: 'poll' | 'stream';
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Sleep aborted'));
      return;
    }
    const timeoutId = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      reject(signal.reason ?? new Error('Sleep aborted'));
    }, { once: true });
  });

export class HorizonListener {
  private readonly eventSource: EventSource;
  private readonly onEvent: (event: RawContractEvent) => Promise<void> | void;
  private readonly onEventFailure?: (event: RawContractEvent, error: unknown) => void | Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly maxRetries: number;
  private readonly logger: Logger;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly backoffOptions: BackoffOptions;
  private readonly mode: 'poll' | 'stream';

  private cursor: string | undefined;
  private running = false;
  private attempt = 0;
  private backfilling = false;
  private sleepAbortController: AbortController | undefined;

  constructor(options: HorizonListenerOptions) {
    this.eventSource = options.eventSource;
    this.onEvent = options.onEvent;
    this.onEventFailure = options.onEventFailure;
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;
    this.maxRetries = options.maxRetries ?? 10;
    this.logger = options.logger ?? consoleLogger;
    this.sleep = options.sleep ?? defaultSleep;
    this.backoffOptions = options.backoffOptions ?? {};
    this.backfilling = options.startLedger != null;
    this.mode = options.mode ?? 'poll';
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
        this.sleepAbortController = new AbortController();
        try {
          await this.sleep(delayMs, this.sleepAbortController.signal);
        } catch (sleepErr) {
          if (this.sleepAbortController.signal.aborted) {
            break;
          }
          throw sleepErr;
        } finally {
          this.sleepAbortController = undefined;
        }
        continue;
      }

      this.attempt = 0;

      for (const event of response.events) {
        try {
          this.logger.info('horizon-listener: received contract event', event);
          await this.onEvent(event);
        } catch (err) {
          this.logger.error('horizon-listener: onEvent handler threw', err);
          if (this.onEventFailure) {
            try {
              await this.onEventFailure(event, err);
            } catch (failureErr) {
              this.logger.error('horizon-listener: onEventFailure handler threw', failureErr);
            }
          }
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

      // In stream mode, skip sleeping when events were returned so the next
      // page is fetched immediately; only sleep during quiet periods.
      if (this.mode === 'stream' && response.events.length > 0) {
        continue;
      }

      this.sleepAbortController = new AbortController();
      try {
        await this.sleep(this.pollIntervalMs, this.sleepAbortController.signal);
      } catch (sleepErr) {
        if (this.sleepAbortController.signal.aborted) {
          break;
        }
        throw sleepErr;
      } finally {
        this.sleepAbortController = undefined;
      }
    }
  }

  stop(): void {
    this.running = false;
    this.sleepAbortController?.abort();
  }
}
