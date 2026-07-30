/**
 * Lightweight, zero-dependency metrics for sanctions-oracle.
 *
 * Design goals
 * ─────────────
 * • Low-cardinality: labels are `phase` and `outcome` only — never addresses,
 *   transaction hashes, or contract IDs. Label cardinality is therefore bounded
 *   by `|phases| × |outcomes|` regardless of how many addresses are processed.
 * • Prometheus-compatible: `MetricsRegistry.expose()` returns a Prometheus
 *   text-format string suitable for scraping from a `/metrics` endpoint.
 * • Optional: the default export is a no-op registry. Operators who want
 *   visibility pass their own `MetricsRegistry`; code paths that receive no
 *   registry stay completely side-effect-free.
 *
 * Phases tracked
 * ──────────────
 * address_check   — each call to `provider.checkAddress()` (sanctions lookup)
 * denylist_write  — each call to `writer.addToDenylist()` (on-chain write)
 */

export type SanctionsPhase = 'address_check' | 'denylist_write';
export type Outcome = 'success' | 'failure' | 'cancelled';

/** A single counter: monotonically increasing integer keyed by phase+outcome. */
export interface Counter {
  inc(phase: SanctionsPhase, outcome: Outcome): void;
  get(phase: SanctionsPhase, outcome: Outcome): number;
}

/**
 * A histogram that tracks duration samples in configurable buckets (ms).
 * Exposes `count`, `sum`, and per-bucket cumulative counts for Prometheus.
 */
export interface Histogram {
  observe(phase: SanctionsPhase, durationMs: number): void;
  snapshot(
    phase: SanctionsPhase,
  ): { count: number; sum: number; buckets: Map<number | '+Inf', number> };
}

// ── Counter implementation ────────────────────────────────────────────────────

class DefaultCounter implements Counter {
  private readonly data = new Map<string, number>();

  private key(phase: SanctionsPhase, outcome: Outcome): string {
    return `${phase}:${outcome}`;
  }

  inc(phase: SanctionsPhase, outcome: Outcome): void {
    const k = this.key(phase, outcome);
    this.data.set(k, (this.data.get(k) ?? 0) + 1);
  }

  get(phase: SanctionsPhase, outcome: Outcome): number {
    return this.data.get(this.key(phase, outcome)) ?? 0;
  }
}

// ── Histogram implementation ──────────────────────────────────────────────────

/**
 * Default bucket upper-bounds (ms).  Covers sub-ms fast paths through
 * multi-second network/RPC calls.
 */
export const DEFAULT_HISTOGRAM_BUCKETS = [5, 25, 100, 250, 500, 1000, 2500, 5000, 10000];

class DefaultHistogram implements Histogram {
  private readonly buckets: number[];
  private readonly observations = new Map<SanctionsPhase, number[]>();

  constructor(buckets: number[] = DEFAULT_HISTOGRAM_BUCKETS) {
    this.buckets = [...buckets].sort((a, b) => a - b);
  }

  observe(phase: SanctionsPhase, durationMs: number): void {
    if (!this.observations.has(phase)) {
      this.observations.set(phase, []);
    }
    this.observations.get(phase)!.push(durationMs);
  }

  snapshot(
    phase: SanctionsPhase,
  ): { count: number; sum: number; buckets: Map<number | '+Inf', number> } {
    const obs = this.observations.get(phase) ?? [];
    const count = obs.length;
    const sum = obs.reduce((acc, v) => acc + v, 0);

    const bucketMap = new Map<number | '+Inf', number>();
    for (const bound of this.buckets) {
      bucketMap.set(
        bound,
        obs.filter((v) => v <= bound).length,
      );
    }
    bucketMap.set('+Inf', count);

    return { count, sum, buckets: bucketMap };
  }
}

// ── No-op implementations (disabled metrics) ─────────────────────────────────

class NoopCounter implements Counter {
  inc(_phase: SanctionsPhase, _outcome: Outcome): void {}
  get(_phase: SanctionsPhase, _outcome: Outcome): number {
    return 0;
  }
}

class NoopHistogram implements Histogram {
  observe(_phase: SanctionsPhase, _durationMs: number): void {}
  snapshot(
    _phase: SanctionsPhase,
  ): { count: number; sum: number; buckets: Map<number | '+Inf', number> } {
    return { count: 0, sum: 0, buckets: new Map() };
  }
}

// ── Registry ──────────────────────────────────────────────────────────────────

export interface MetricsRegistryOptions {
  /** Prefix prepended to every metric name (default: `sanctions_oracle`). */
  prefix?: string;
  /** Custom histogram bucket boundaries in milliseconds. */
  histogramBuckets?: number[];
}

/**
 * Holds a counter and a histogram for sanctions-oracle phases.
 *
 * Pass an instance to `SyncOptions.metrics` to enable recording.  Omit it to
 * use the built-in no-op registry — there is zero overhead.
 */
export class MetricsRegistry {
  readonly counter: Counter;
  readonly histogram: Histogram;
  private readonly prefix: string;

  constructor(options: MetricsRegistryOptions = {}) {
    this.prefix = options.prefix ?? 'sanctions_oracle';
    this.counter = new DefaultCounter();
    this.histogram = new DefaultHistogram(options.histogramBuckets);
  }

  /**
   * Emit a Prometheus text-format exposition for all tracked metrics.
   *
   * Example output:
   * ```
   * # HELP sanctions_oracle_requests_total Total requests by phase and outcome
   * # TYPE sanctions_oracle_requests_total counter
   * sanctions_oracle_requests_total{phase="address_check",outcome="success"} 100
   * ...
   * ```
   */
  expose(): string {
    const lines: string[] = [];

    const counterName = `${this.prefix}_requests_total`;
    lines.push(`# HELP ${counterName} Total requests by phase and outcome`);
    lines.push(`# TYPE ${counterName} counter`);

    const phases: SanctionsPhase[] = ['address_check', 'denylist_write'];
    const outcomes: Outcome[] = ['success', 'failure', 'cancelled'];

    for (const phase of phases) {
      for (const outcome of outcomes) {
        const v = this.counter.get(phase, outcome);
        lines.push(`${counterName}{phase="${phase}",outcome="${outcome}"} ${v}`);
      }
    }

    const histName = `${this.prefix}_duration_ms`;
    lines.push(`# HELP ${histName}_bucket Histogram of phase durations in milliseconds`);
    lines.push(`# TYPE ${histName} histogram`);

    for (const phase of phases) {
      const { count, sum, buckets } = this.histogram.snapshot(phase);
      for (const [le, cumCount] of buckets) {
        lines.push(`${histName}_bucket{phase="${phase}",le="${String(le)}"} ${cumCount}`);
      }
      lines.push(`${histName}_sum{phase="${phase}"} ${sum}`);
      lines.push(`${histName}_count{phase="${phase}"} ${count}`);
    }

    return lines.join('\n') + '\n';
  }
}

// ── No-op registry singleton ──────────────────────────────────────────────────

/**
 * A no-op registry that discards all observations.
 * Used as the default so callers that don't provide a registry pay no cost.
 */
export class NoopMetricsRegistry {
  readonly counter: Counter = new NoopCounter();
  readonly histogram: Histogram = new NoopHistogram();

  expose(): string {
    return '';
  }
}

export type AnyMetricsRegistry = MetricsRegistry | NoopMetricsRegistry;
