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
 */
export class MetricsRegistry extends GenericMetricsRegistry<Phase> {
  private readonly gaugePrefix: string;
  private ledgerLag = 0;
  private dlqSize = 0;

  constructor(options: MetricsRegistryOptions = {}) {
    const prefix = options.prefix ?? 'horizon_listener';
    super({ ...options, prefix, phases: PHASES });
    this.gaugePrefix = prefix;
  }

  /** Sets the `<prefix>_ledger_lag` gauge (latest ledger − processed ledger). */
  setLedgerLag(lag: number): void {
    this.ledgerLag = lag;
  }

  getLedgerLag(): number {
    return this.ledgerLag;
  }

  /** Sets the `<prefix>_dlq_size` gauge (current dead-letter queue depth). */
  setDlqSize(size: number): void {
    this.dlqSize = size;
  }

  getDlqSize(): number {
    return this.dlqSize;
  }

  override expose(): string {
    const lagName = `${this.gaugePrefix}_ledger_lag`;
    const dlqName = `${this.gaugePrefix}_dlq_size`;
    return (
      super.expose() +
      `# HELP ${lagName} Latest ledger minus last processed ledger\n` +
      `# TYPE ${lagName} gauge\n${lagName} ${this.ledgerLag}\n` +
      `# HELP ${dlqName} Current number of dead-lettered events\n` +
      `# TYPE ${dlqName} gauge\n${dlqName} ${this.dlqSize}\n`
    );
  }
}

/**
 * A no-op registry that discards all observations.
 * Used as the default so callers that don't provide a registry pay no cost.
 */
export class NoopMetricsRegistry extends GenericNoopMetricsRegistry<Phase> {
  setLedgerLag(_lag: number): void {}

  getLedgerLag(): number {
    return 0;
  }

  setDlqSize(_size: number): void {}

  getDlqSize(): number {
    return 0;
  }
}

export type AnyMetricsRegistry = MetricsRegistry | NoopMetricsRegistry;
