/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

export type JitterStrategy = 'half' | 'full' | 'none';

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  jitter?: boolean;
  randomFn?: () => number;
  jitterStrategy?: JitterStrategy;
  jitterMin?: number;
  jitterMax?: number;
}

// randomFn is injectable (defaulting to Math.random) so tests can assert an
// exact delay instead of a range, and so callers can disable jitter entirely
// for deterministic timing assertions.
export function computeBackoffDelayMs(attempt: number, options: BackoffOptions = {}): number {
  const baseMs = options.baseMs ?? 500;
  const maxMs = options.maxMs ?? 30000;
  const jitter = options.jitter ?? true;
  const randomFn = options.randomFn ?? Math.random;

  const uncapped = baseMs * 2 ** attempt;
  const capped = Math.min(maxMs, uncapped);

  if (!jitter || options.jitterStrategy === 'none') {
    return capped;
  }

  const defaultMin = options.jitterStrategy === 'full' ? 0 : 0.5;
  const defaultMax = 1;
  const min = options.jitterMin ?? defaultMin;
  const max = options.jitterMax ?? defaultMax;

  const jitterFactor = min + randomFn() * (max - min);
  return capped * jitterFactor;
}
