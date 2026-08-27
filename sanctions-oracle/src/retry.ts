/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

export interface RetryOptions {
  /** Total attempts before giving up, including the first. Defaults to 3. */
  maxAttempts?: number;
  baseMs?: number;
  maxMs?: number;
  jitter?: boolean;
  randomFn?: () => number;
  /** Injectable so tests don't have to wait out real backoff delays. */
  sleepFn?: (ms: number) => Promise<void>;
}

// Same growth curve as horizon-listener's computeBackoffDelayMs (base * 2^attempt,
// capped, optional +/-50% jitter) reimplemented here so sanctions-oracle doesn't
// need a cross-package dependency for one small function.
function computeBackoffDelayMs(
  attempt: number,
  options: Required<Pick<RetryOptions, 'baseMs' | 'maxMs' | 'jitter' | 'randomFn'>>,
): number {
  const { baseMs, maxMs, jitter, randomFn } = options;

  const uncapped = baseMs * 2 ** attempt;
  const capped = Math.min(maxMs, uncapped);

  if (!jitter) {
    return capped;
  }

  const jitterFactor = 0.5 + randomFn() * 0.5;
  return capped * jitterFactor;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Runs `fn`, retrying on rejection up to `maxAttempts` total attempts with
 * exponential backoff between tries. Rethrows the last error if every
 * attempt fails.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseMs = options.baseMs ?? 500;
  const maxMs = options.maxMs ?? 30000;
  const jitter = options.jitter ?? true;
  const randomFn = options.randomFn ?? Math.random;
  const sleepFn = options.sleepFn ?? defaultSleep;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt >= maxAttempts) {
        throw err;
      }
      const delay = computeBackoffDelayMs(attempt - 1, { baseMs, maxMs, jitter, randomFn });
      await sleepFn(delay);
    }
  }
}
