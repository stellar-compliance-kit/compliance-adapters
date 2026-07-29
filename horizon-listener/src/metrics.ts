/**
 * Lightweight, zero-dependency metrics for horizon-listener.
 *
 * Design goals
 * ─────────────
 * • Low-cardinality: labels are `phase` and `outcome` only — never ledger IDs,
 *   contract addresses, or cursor values. This keeps the time-series count
 *   bounded regardless of how long the listener runs.
 * • Prometheus-compatible: `MetricsRegistry.expose()` returns a Prometheus
 *   text-format string suitable for scraping from a `/metrics` endpoint.
 * • Optional: the default export is a no-op registry. Operators who want
 *   visibility pass their own `MetricsRegistry` instance; code paths that
 *   receive no registry stay completely side-effect-free.
 *
 * Phases tracked
 * ──────────────
 * rpc_poll    — each call to `eventSource.getEvents()`
 * event_relay — each call to the `onEvent` handler (one per received event)
 * webhook     — each call to a `WebhookSender.send()` (tracked at call site)
 */

export type Phase = 'rpc_poll' | 'event_relay' | 'webhook';
export type Outcome = 'success' | 'failure' | 'cancelled';

/** A single counter: monotonically increasing integer keyed by phase+outcome. */
export interface Counter {
  inc(phase: Phase, outcome: Outcome): void;
  get(phase: Phase, outcome: Outcome): number;
}

/**
 * A histogram that tracks duration samples in configurable buckets (ms).
 * Exposes `count`, `sum`, and per-bucket cumulative counts for Prometheus.
 */
export interface Histogram {
  observe(phase: Phase, durationMs: number): void;
  /**
   * Returns `{ count, sum, buckets }` for a given phase.
   * `buckets` maps upper-bound (ms) → cumulative count of observations ≤ that
   * bound. An `+Inf` bucket is appended automatically.
   */
  snapshot(phase: Phase): { count: number; sum: number; buckets: Map<number | '+Inf', number> };
}

// ── Counter implementation ────────────────────────────────────────────────────

class DefaultCounter implements Counter {
  private readonly data = new Map<string, number>();

  private key(phase: Phase, outcome: Outcome): string {
    return `${phase}:${outcome}`;
  }

  inc(phase: Phase, outcome: Outcome): void {
    const k = this.key(phase, outcome);
    this.data.set(k, (this.data.get(k) ?? 0) + 1);
  }

  get(phase: Phase, outcome: Outcome): number {
    return this.data.get(this.key(phase, outcome)) ?? 0;
  }
}

// ── Histogram implementation ──────────────────────────────────────────────────

/**
 * Default bucket upper-bounds (ms).  They cover sub-millisecond fast paths all
 * the way through 10 s network timeouts typical for RPC calls.
 */
export const DEFAULT_HISTOGRAM_BUCKETS = [5, 25, 100, 250, 500, 1000, 2500, 5000, 10000];

class DefaultHistogram implements Histogram {
  private readonly buckets: number[];
  // phase → raw observation list
  private readonly observations = new Map<Phase, number[]>();

  constructor(buckets: number[] = DEFAULT_HISTOGRAM_BUCKETS) {
    this.buckets = [...buckets].sort((a, b) => a - b);
  }

  observe(phase: Phase, durationMs: number): void {
    if (!this.observations.has(phase)) {
      this.observations.set(phase, []);
    }
    this.observations.get(phase)!.push(durationMs);
  }

  snapshot(phase: Phase): { count: number; sum: number; buckets: Map<number | '+Inf', number> } {
    const obs = this.observations.get(phase) ?? [];
    const count = obs.length;
    const sum = obs.reduce((acc, v) => acc + v, 0);

    const bucketMap = new Map<number | '+Inf', number>();
    for (const bound of this.buckets) {
      const cumulative = obs.filter((v) => v <= bound).length;
      bucketMap.set(bound, cumulative);
    }
    // +Inf bucket always equals total count (all observations are ≤ infinity)
    bucketMap.set('+Inf', count);

    return { count, sum, buckets: bucketMap };
  }
}

// ── No-op implementations (disabled metrics) ─────────────────────────────────

class NoopCounter implements Counter {
  inc(_phase: Phase, _outcome: Outcome): void {}
  get(_phase: Phase, _outcome: Outcome): number {
    return 0;
  }
}

class NoopHistogram implements Histogram {
  observe(_phase: Phase, _durationMs: number): void {}
  snapshot(_phase: Phase): { count: number; sum: number; buckets: Map<number | '+Inf', number> } {
    return { count: 0, sum: 0, buckets: new Map() };
  }
}

// ── Registry ──────────────────────────────────────────────────────────────────

export interface MetricsRegistryOptions {
  /** Prefix prepended to every metric name (default: `horizon_listener`). */
  prefix?: string;
  /** Custom histogram bucket boundaries in milliseconds. */
  histogramBuckets?: number[];
}

/**
 * Holds a counter and a histogram for horizon-listener phases.
 *
 * Pass an instance to `HorizonListenerOptions.metrics` (or
 * `HttpWebhookSenderOptions.metrics`) to enable recording.  Omit it entirely
 * to use the built-in no-op registry — there is zero overhead.
 */
export class MetricsRegistry {
  readonly counter: Counter;
  readonly histogram: Histogram;
  private readonly prefix: string;

  constructor(options: MetricsRegistryOptions = {}) {
    this.prefix = options.prefix ?? 'horizon_listener';
    this.counter = new DefaultCounter();
    this.histogram = new DefaultHistogram(options.histogramBuckets);
  }

  /**
   * Emit a Prometheus text-format exposition for all tracked metrics.
   *
   * Example output:
   * ```
   * # HELP horizon_listener_requests_total Total requests by phase and outcome
   * # TYPE horizon_listener_requests_total counter
   * horizon_listener_requests_total{phase="rpc_poll",outcome="success"} 42
   * ...
   * # HELP horizon_listener_duration_ms_bucket Histogram of phase durations (ms)
   * # TYPE horizon_listener_duration_ms histogram
   * horizon_listener_duration_ms_bucket{phase="rpc_poll",le="5"} 3
   * ...
   * ```
   */
  expose(): string {
    const lines: string[] = [];

    // ── Counter ──────────────────────────────────────────────────────────────
    const counterName = `${this.prefix}_requests_total`;
    lines.push(`# HELP ${counterName} Total requests by phase and outcome`);
    lines.push(`# TYPE ${counterName} counter`);

    const phases: Phase[] = ['rpc_poll', 'event_relay', 'webhook'];
    const outcomes: Outcome[] = ['success', 'failure', 'cancelled'];

    for (const phase of phases) {
      for (const outcome of outcomes) {
        const v = this.counter.get(phase, outcome);
        lines.push(`${counterName}{phase="${phase}",outcome="${outcome}"} ${v}`);
      }
    }

    // ── Histogram ────────────────────────────────────────────────────────────
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

// ── Shared no-op singleton ────────────────────────────────────────────────────

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
