export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  jitter?: boolean;
  randomFn?: () => number;
}

export function computeBackoffDelayMs(attempt: number, options: BackoffOptions = {}): number {
  const baseMs = options.baseMs ?? 500;
  const maxMs = options.maxMs ?? 30000;
  const jitter = options.jitter ?? true;
  const randomFn = options.randomFn ?? Math.random;

  const uncapped = baseMs * 2 ** attempt;
  const capped = Math.min(maxMs, uncapped);

  if (!jitter) {
    return capped;
  }

  const jitterFactor = 0.5 + randomFn() * 0.5;
  return capped * jitterFactor;
}
