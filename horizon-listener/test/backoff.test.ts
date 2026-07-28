import { computeBackoffDelayMs } from '../src/backoff';

describe('computeBackoffDelayMs', () => {
  it('grows exponentially with the attempt number when jitter is disabled', () => {
    const delays = [0, 1, 2, 3, 4].map((attempt) =>
      computeBackoffDelayMs(attempt, { jitter: false }),
    );

    expect(delays).toEqual([500, 1000, 2000, 4000, 8000]);
  });

  it('caps the delay at maxMs', () => {
    const delay = computeBackoffDelayMs(10, { jitter: false, maxMs: 30000 });
    expect(delay).toBe(30000);
  });

  it('respects a custom baseMs', () => {
    const delay = computeBackoffDelayMs(2, { jitter: false, baseMs: 100 });
    expect(delay).toBe(400);
  });

  it('is deterministic when a fixed randomFn is injected', () => {
    const delay = computeBackoffDelayMs(1, { randomFn: () => 0.5 });
    // uncapped = 500 * 2^1 = 1000, jitter factor = 0.5 + 0.5*0.5 = 0.75
    expect(delay).toBe(750);
  });

  it('applies jitter within the documented [0.5, 1) range of the capped value', () => {
    const first = computeBackoffDelayMs(3, { randomFn: Math.random });
    const second = computeBackoffDelayMs(3, { randomFn: Math.random });

    const cappedValue = 500 * 2 ** 3;

    for (const delay of [first, second]) {
      expect(delay).toBeGreaterThanOrEqual(cappedValue * 0.5);
      expect(delay).toBeLessThan(cappedValue);
    }
  });

  it('returns exactly min(maxMs, baseMs * 2**attempt) when jitter is disabled', () => {
    const testCases = [
      { attempt: 0, baseMs: 500, maxMs: 30000, expected: 500 },
      { attempt: 1, baseMs: 500, maxMs: 30000, expected: 1000 },
      { attempt: 2, baseMs: 500, maxMs: 30000, expected: 2000 },
      { attempt: 5, baseMs: 500, maxMs: 30000, expected: 16000 },
      { attempt: 6, baseMs: 500, maxMs: 30000, expected: 30000 },
      { attempt: 7, baseMs: 500, maxMs: 30000, expected: 30000 },
      { attempt: 3, baseMs: 100, maxMs: 5000, expected: 800 },
      { attempt: 4, baseMs: 100, maxMs: 5000, expected: 1600 },
      { attempt: 5, baseMs: 100, maxMs: 5000, expected: 3200 },
      { attempt: 6, baseMs: 100, maxMs: 5000, expected: 5000 },
    ];

    for (const { attempt, baseMs, maxMs, expected } of testCases) {
      const delay = computeBackoffDelayMs(attempt, { jitter: false, baseMs, maxMs });
      expect(delay).toBe(expected);
    }
  });

  it('never exceeds maxMs at high attempt counts and does not overflow or produce NaN', () => {
    const maxMs = 30000;
    const testAttempts = [10, 20, 50, 100, 1000];

    for (const attempt of testAttempts) {
      const delay = computeBackoffDelayMs(attempt, { jitter: false, maxMs });
      expect(delay).toBe(maxMs);
      expect(Number.isNaN(delay)).toBe(false);
      expect(Number.isFinite(delay)).toBe(true);
    }
  });
});
