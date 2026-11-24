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
  type Counter,
  type Gauge,
  type Histogram,
  type Outcome,
  type PhaseMetricsRegistryOptions,
} from '@compliance-adapters/metrics';

export { DEFAULT_HISTOGRAM_BUCKETS, metricsHandler, OtlpMetricsExporter } from '@compliance-adapters/metrics';
export type { Counter, Histogram, Outcome };
export { DEFAULT_HISTOGRAM_BUCKETS };
export type { Counter, Gauge, Histogram, Outcome };

export type Phase = 'rpc_poll' | 'event_relay' | 'webhook' | 'rpc_failover';

const PHASES: Phase[] = ['rpc_poll', 'event_relay', 'webhook', 'rpc_failover'];

/** `prefix` defaults to `horizon_listener`. */
export type MetricsRegistryOptions = PhaseMetricsRegistryOptions<Phase>;

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
 */
export class NoopMetricsRegistry extends GenericNoopMetricsRegistry<Phase> {
  setLedgerLag(_lag: number): void {}

  getLedgerLag(): number {
    return 0;
  }
}

export type AnyMetricsRegistry = MetricsRegistry | NoopMetricsRegistry;
