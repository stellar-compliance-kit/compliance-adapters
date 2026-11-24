/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * OTLP/HTTP (JSON) export for `MetricsRegistry`, for operators who run an
 * OpenTelemetry collector instead of Prometheus scraping. Zero dependencies:
 * payloads follow the OTLP `ExportMetricsServiceRequest` JSON encoding and
 * are POSTed with the global `fetch` (Node ≥ 20).
 */

import type { MetricsRegistry, Outcome } from './index';

const OUTCOMES: Outcome[] = ['success', 'failure', 'cancelled'];
/** OTLP AggregationTemporality.CUMULATIVE */
const CUMULATIVE = 2;

type Attr = { key: string; value: { stringValue: string } };
const attr = (key: string, value: string): Attr => ({ key, value: { stringValue: value } });

/** Minimal OTLP `ExportMetricsServiceRequest` JSON shape. */
export interface OtlpExportRequest {
  resourceMetrics: Array<{
    resource: { attributes: Attr[] };
    scopeMetrics: Array<{
      scope: { name: string };
      metrics: Array<Record<string, unknown>>;
    }>;
  }>;
}

/**
 * Convert a registry snapshot into an OTLP JSON request body.
 * Counters map to monotonic cumulative Sums; histograms to cumulative
 * Histograms with explicit bounds (OTLP uses per-bucket, not cumulative,
 * counts — converted here).
 */
export function toOtlpMetrics<Phase extends string>(
  registry: MetricsRegistry<Phase>,
  options: { serviceName?: string; startTimeMs?: number; nowMs?: number } = {},
): OtlpExportRequest {
  const now = String(BigInt(options.nowMs ?? Date.now()) * 1_000_000n);
  const start = String(BigInt(options.startTimeMs ?? options.nowMs ?? Date.now()) * 1_000_000n);
  const { prefix, phases } = registry;

  const counterPoints = phases.flatMap((phase) =>
    OUTCOMES.map((outcome) => ({
      attributes: [attr('phase', phase), attr('outcome', outcome)],
      startTimeUnixNano: start,
      timeUnixNano: now,
      asInt: String(registry.counter.get(phase, outcome)),
    })),
  );

  const histogramPoints = phases.map((phase) => {
    const { count, sum, buckets } = registry.histogram.snapshot(phase);
    const explicitBounds: number[] = [];
    const bucketCounts: string[] = [];
    let prev = 0;
    for (const [le, cumulative] of buckets) {
      if (le !== '+Inf') explicitBounds.push(le);
      bucketCounts.push(String(cumulative - prev));
      prev = cumulative;
    }
    return {
      attributes: [attr('phase', phase)],
      startTimeUnixNano: start,
      timeUnixNano: now,
      count: String(count),
      sum,
      explicitBounds,
      bucketCounts,
    };
  });

  return {
    resourceMetrics: [
      {
        resource: { attributes: [attr('service.name', options.serviceName ?? prefix)] },
        scopeMetrics: [
          {
            scope: { name: '@compliance-adapters/metrics' },
            metrics: [
              {
                name: `${prefix}_requests_total`,
                description: 'Total requests by phase and outcome',
                sum: {
                  dataPoints: counterPoints,
                  aggregationTemporality: CUMULATIVE,
                  isMonotonic: true,
                },
              },
              {
                name: `${prefix}_duration_ms`,
                description: 'Histogram of phase durations in milliseconds',
                unit: 'ms',
                histogram: { dataPoints: histogramPoints, aggregationTemporality: CUMULATIVE },
              },
            ],
          },
        ],
      },
    ],
  };
}

export interface OtlpMetricsExporterOptions {
  /** Collector endpoint, e.g. `http://localhost:4318/v1/metrics`. */
  url: string;
  /** Extra request headers (auth, tenant id, …). */
  headers?: Record<string, string>;
  /** `service.name` resource attribute (default: registry prefix). */
  serviceName?: string;
  /** Push interval for `start()` in ms (default: 60000). */
  intervalMs?: number;
  /** Called when an export fails. Errors never propagate otherwise. */
  onError?: (err: unknown) => void;
  /** Override `fetch` (testing / custom agents). */
  fetch?: typeof fetch;
}

/** Periodically pushes a registry's metrics to an OTLP/HTTP collector. */
export class OtlpMetricsExporter<Phase extends string> {
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly startTimeMs = Date.now();

  constructor(
    private readonly registry: MetricsRegistry<Phase>,
    private readonly options: OtlpMetricsExporterOptions,
  ) {}

  /** Export once. Resolves `true` on a 2xx response, `false` otherwise. */
  async export(): Promise<boolean> {
    const doFetch = this.options.fetch ?? fetch;
    try {
      const body = toOtlpMetrics(this.registry, {
        serviceName: this.options.serviceName,
        startTimeMs: this.startTimeMs,
      });
      const res = await doFetch(this.options.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.options.headers },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`OTLP export failed with HTTP ${res.status}`);
      return true;
    } catch (err) {
      this.options.onError?.(err);
      return false;
    }
  }

  /** Start periodic export. The timer is `unref`'d so it never blocks exit. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.export(), this.options.intervalMs ?? 60_000);
    this.timer.unref?.();
  }

  /** Stop periodic export and flush a final batch. */
  async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.export();
  }
}
