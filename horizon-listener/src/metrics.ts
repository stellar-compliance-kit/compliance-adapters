/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * horizon-listener's phase-specific binding of the generic
 * `@compliance-adapters/metrics` registry (shared with sanctions-oracle).
 *
 * Phases tracked
 * ──────────────
 * rpc_poll    — each call to `eventSource.getEvents()`
 * event_relay — each call to the `onEvent` handler (one per received event)
 * webhook     — each call to a `WebhookSender.send()` (tracked at call site)
 *
 * Gauges
 * ──────
 * ledger_lag  — latest ledger reported by RPC minus the last processed ledger
 */

import {
  MetricsRegistry as GenericMetricsRegistry,
  NoopMetricsRegistry as GenericNoopMetricsRegistry,
  DEFAULT_HISTOGRAM_BUCKETS,
  type Counter,
  type Gauge,
  type Histogram,
  type Outcome,
  type MetricsRegistryOptions as GenericMetricsRegistryOptions,
} from '@compliance-adapters/metrics';

export { DEFAULT_HISTOGRAM_BUCKETS };
export type { Counter, Gauge, Histogram, Outcome };

export type Phase = 'rpc_poll' | 'event_relay' | 'webhook' | 'rpc_failover';

const PHASES: Phase[] = ['rpc_poll', 'event_relay', 'webhook', 'rpc_failover'];

export type MetricsRegistryOptions = Omit<
  GenericMetricsRegistryOptions<Phase>,
  'phases' | 'prefix'
> & {
  /** Prefix prepended to every metric name (default: `horizon_listener`). */
  prefix?: string;
};

/**
 * Holds a counter and a histogram for horizon-listener phases.
 *
 * Pass an instance to `HorizonListenerOptions.metrics` (or
 * `HttpWebhookSenderOptions.metrics`) to enable recording.  Omit it entirely
 * to use the built-in no-op registry — there is zero overhead.
 *
 * @example
 * ```ts
 * import { MetricsRegistry } from 'horizon-listener';
 *
 * const metrics = new MetricsRegistry({ prefix: 'my_listener' });
 * metrics.setLedgerLag(3);
 * console.log(metrics.expose()); // Prometheus text exposition
 * ```
 */
export class MetricsRegistry extends GenericMetricsRegistry<Phase> {
  private readonly gaugePrefix: string;
  private ledgerLag = 0;

  constructor(options: MetricsRegistryOptions = {}) {
    const prefix = options.prefix ?? 'horizon_listener';
    super({ ...options, prefix, phases: PHASES });
    this.gaugePrefix = prefix;
  }

  /**
   * Sets the `<prefix>_ledger_lag` gauge (latest ledger − processed ledger).
   *
   * @example
   * ```ts
   * const metrics = new MetricsRegistry();
   * metrics.setLedgerLag(5);
   * metrics.getLedgerLag(); // 5
   * ```
   */
  setLedgerLag(lag: number): void {
    this.ledgerLag = lag;
  }

  /**
   * Returns the most recently recorded ledger lag.
   *
   * @example
   * ```ts
   * const metrics = new MetricsRegistry();
   * metrics.setLedgerLag(2);
   * metrics.getLedgerLag(); // 2
   * ```
   */
  getLedgerLag(): number {
    return this.ledgerLag;
  }

  /**
   * Renders all metrics in Prometheus text exposition format, including the
   * `ledger_lag` gauge.
   *
   * @example
   * ```ts
   * const metrics = new MetricsRegistry({ prefix: 'demo' });
   * metrics.setLedgerLag(1);
   * const text = metrics.expose();
   * // contains: demo_ledger_lag 1
   * ```
   */
  override expose(): string {
    const name = `${this.gaugePrefix}_ledger_lag`;
    return (
      super.expose() +
      `# HELP ${name} Latest ledger minus last processed ledger\n` +
      `# TYPE ${name} gauge\n${name} ${this.ledgerLag}\n`
    );
  }
}

/**
 * A no-op registry that discards all observations.
 * Used as the default so callers that don't provide a registry pay no cost.
 *
 * @example
 * ```ts
 * import { NoopMetricsRegistry } from 'horizon-listener';
 *
 * const metrics = new NoopMetricsRegistry();
 * metrics.setLedgerLag(10);   // discarded
 * metrics.getLedgerLag();     // 0
 * ```
 */
export class NoopMetricsRegistry extends GenericNoopMetricsRegistry<Phase> {
  /**
   * Discards the provided ledger lag.
   *
   * @example
   * ```ts
   * new NoopMetricsRegistry().setLedgerLag(42); // no-op
   * ```
   */
  setLedgerLag(_lag: number): void {}

  /**
   * Always returns `0`.
   *
   * @example
   * ```ts
   * new NoopMetricsRegistry().getLedgerLag(); // 0
   * ```
   */
  getLedgerLag(): number {
    return 0;
  }
}

export type AnyMetricsRegistry = MetricsRegistry | NoopMetricsRegistry;
