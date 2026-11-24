/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import {
  DEFAULT_SUMMARY_QUANTILES,
  MetricsRegistry,
  NoopMetricsRegistry,
} from '../src/index';

type Phase = 'fetch' | 'parse';

describe('summary metric', () => {
  it('computes configured quantiles with linear interpolation', () => {
    const registry = new MetricsRegistry<Phase>({
      phases: ['fetch'],
      prefix: 'svc',
      summaryQuantiles: [0.5, 0.9],
    });
    [1, 2, 3, 4, 5].forEach((value) => registry.summary.observe('fetch', value));

    const snapshot = registry.summary.snapshot('fetch');
    expect(snapshot.count).toBe(5);
    expect(snapshot.sum).toBe(15);
    expect(snapshot.quantiles.get(0.5)).toBe(3);
    expect(snapshot.quantiles.get(0.9)).toBeCloseTo(4.6);
  });

  it('keeps phases isolated and returns zeros for unobserved phases', () => {
    const registry = new MetricsRegistry<Phase>({
      phases: ['fetch', 'parse'],
      prefix: 'svc',
      summaryQuantiles: [0.5],
    });
    registry.summary.observe('fetch', 7);

    expect(registry.summary.snapshot('parse').count).toBe(0);
    expect(registry.summary.snapshot('parse').sum).toBe(0);
    expect(registry.summary.snapshot('parse').quantiles.get(0.5)).toBe(0);
    expect(registry.summary.snapshot('fetch').quantiles.get(0.5)).toBe(7);
  });

  it('exposes HELP, TYPE, quantile, sum, and count lines in Prometheus format', () => {
    const registry = new MetricsRegistry<Phase>({
      phases: ['fetch'],
      prefix: 'svc',
      summaryQuantiles: [0.5, 0.99],
    });
    registry.summary.observe('fetch', 10);
    registry.summary.observe('fetch', 20);

    const output = registry.expose();
    expect(output).toContain('# HELP svc_summary Summary of observed values by phase');
    expect(output).toContain('# TYPE svc_summary summary');
    expect(output).toContain('svc_summary{phase="fetch",quantile="0.5"} 15');
    expect(output).toContain('svc_summary{phase="fetch",quantile="0.99"} 19.9');
    expect(output).toContain('svc_summary_sum{phase="fetch"} 30');
    expect(output).toContain('svc_summary_count{phase="fetch"} 2');
    expect(output.endsWith('\n')).toBe(true);
  });

  it('omits summary lines unless enabled and supports the default quantiles', () => {
    expect(new MetricsRegistry<Phase>({ phases: ['fetch'], prefix: 'svc' }).expose()).not.toContain(
      'svc_summary',
    );

    const registry = new MetricsRegistry<Phase>({
      phases: ['fetch'],
      prefix: 'svc',
      summary: true,
    });
    const output = registry.expose();
    for (const q of DEFAULT_SUMMARY_QUANTILES) {
      expect(output).toContain(`quantile="${q}"`);
    }
  });

  it('rejects invalid quantiles', () => {
    expect(
      () =>
        new MetricsRegistry<Phase>({
          phases: ['fetch'],
          prefix: 'svc',
          summaryQuantiles: [1.5],
        }),
    ).toThrow();
  });

  it('no-op registry summaries stay empty', () => {
    const registry = new NoopMetricsRegistry<Phase>();
    registry.summary.observe('fetch', 42);
    expect(registry.summary.snapshot('fetch')).toEqual({ count: 0, sum: 0, quantiles: new Map() });
    expect(registry.expose()).toBe('');
  });
});
