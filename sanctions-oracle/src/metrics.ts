/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * sanctions-oracle's phase-specific binding of the generic
 * `@compliance-adapters/metrics` registry (shared with horizon-listener).
 *
 * Phases tracked
 * ──────────────
 * address_check   — each call to `provider.checkAddress()` (sanctions lookup)
 * denylist_write  — each call to `writer.addToDenylist()` (on-chain write)
 */

import {
  MetricsRegistry as GenericMetricsRegistry,
  NoopMetricsRegistry as GenericNoopMetricsRegistry,
  DEFAULT_HISTOGRAM_BUCKETS,
  type Counter,
  type Histogram,
  type Outcome,
  type MetricsRegistryOptions as GenericMetricsRegistryOptions,
} from '@compliance-adapters/metrics';

export { DEFAULT_HISTOGRAM_BUCKETS };
export type { Counter, Histogram, Outcome };

export type SanctionsPhase = 'address_check' | 'denylist_write';

const PHASES: SanctionsPhase[] = ['address_check', 'denylist_write'];

export type MetricsRegistryOptions = Omit<
  GenericMetricsRegistryOptions<SanctionsPhase>,
  'phases' | 'prefix'
> & {
  /** Prefix prepended to every metric name (default: `sanctions_oracle`). */
  prefix?: string;
};

/**
 * Holds a counter and a histogram for sanctions-oracle phases.
 *
 * Pass an instance to `SyncOptions.metrics` to enable recording.  Omit it to
 * use the built-in no-op registry — there is zero overhead.
 */
export class MetricsRegistry extends GenericMetricsRegistry<SanctionsPhase> {
  private readonly gaugePrefix: string;
  private readonly providerLastSuccessMs = new Map<string, number>();

  constructor(options: MetricsRegistryOptions = {}) {
    const prefix = options.prefix ?? 'sanctions_oracle';
    super({ ...options, prefix, phases: PHASES });
    this.gaugePrefix = prefix;
  }

  /**
   * Records a successful fetch for a named provider. Pass `timestampMs` to
   * inject a clock in tests; defaults to `Date.now()`.
   */
  markProviderSuccess(provider: string, timestampMs: number = Date.now()): void {
    this.providerLastSuccessMs.set(provider, timestampMs);
  }

  /** Unix epoch milliseconds of the provider's last successful fetch. */
  getProviderLastSuccessMs(provider: string): number | undefined {
    return this.providerLastSuccessMs.get(provider);
  }

  /** Snapshot of all known provider freshness timestamps, keyed by provider. */
  getProviderFreshnessSnapshot(): Record<string, number> {
    return Object.fromEntries(this.providerLastSuccessMs);
  }

  /**
   * Prometheus exposition including a per-provider gauge of the last
   * successful fetch time (Unix seconds). Scrape with
   * `time() - sanctions_oracle_provider_last_success_timestamp_seconds` to
   * alert on stale provider data.
   */
  override expose(): string {
    const name = `${this.gaugePrefix}_provider_last_success_timestamp_seconds`;
    const lines = [
      `# HELP ${name} Unix timestamp of the last successful fetch per provider`,
      `# TYPE ${name} gauge`,
    ];
    for (const [provider, timestampMs] of this.providerLastSuccessMs) {
      const label = provider.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
      lines.push(`${name}{provider="${label}"} ${(timestampMs / 1000).toFixed(3)}`);
    }
    return super.expose() + lines.join('\n') + '\n';
  }
}

/**
 * A no-op registry that discards all observations.
 * Used as the default so callers that don't provide a registry pay no cost.
 */
export class NoopMetricsRegistry extends GenericNoopMetricsRegistry<SanctionsPhase> {
  markProviderSuccess(_provider: string, _timestampMs?: number): void {}

  getProviderLastSuccessMs(_provider: string): number | undefined {
    return undefined;
  }

  getProviderFreshnessSnapshot(): Record<string, number> {
    return {};
  }
}

export type AnyMetricsRegistry = MetricsRegistry | NoopMetricsRegistry;
