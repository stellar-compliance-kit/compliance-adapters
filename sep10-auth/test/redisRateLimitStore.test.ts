/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

///<reference types="jest" />
import {
  RedisRateLimitStore,
  RedisEvalLike,
} from '../examples/redisRateLimitStore';
import { rateLimiter } from '../src/rate-limiter';

// ---------------------------------------------------------------------------
// In-process Redis mock
// ---------------------------------------------------------------------------

/**
 * Minimal in-memory stub that runs the same INCR + PEXPIRE + PTTL logic the
 * Lua script performs on a real Redis, without needing a live server.
 *
 * The stub is intentionally simple:
 *   - `eval()` intercepts the exact script the store sends and executes the
 *     equivalent logic in JS.
 *   - Keys expire by comparing wall-clock time (via `Date.now()`), so tests
 *     use `jest.useFakeTimers()` / `jest.advanceTimersByTime()` to control TTLs.
 */
function makeRedisMock(): jest.Mocked<RedisEvalLike> & { _store: Map<string, { value: number; expiresAt: number }> } {
  const store = new Map<string, { value: number; expiresAt: number }>();

  const mock = {
    _store: store,
    eval: jest.fn(async (_script: string, _numkeys: number, key: string, windowMsStr: string) => {
      const now = Date.now();
      const windowMs = Number(windowMsStr);

      // Evict an expired entry so INCR starts fresh.
      const existing = store.get(key);
      if (existing !== undefined && existing.expiresAt <= now) {
        store.delete(key);
      }

      const entry = store.get(key);
      if (entry === undefined) {
        // First request in this window — set count and TTL.
        store.set(key, { value: 1, expiresAt: now + windowMs });
        return [1, windowMs];
      }

      // Subsequent request — increment, leave TTL unchanged.
      entry.value += 1;
      const remaining = entry.expiresAt - now;
      return [entry.value, remaining];
    }),
  } as jest.Mocked<RedisEvalLike> & { _store: Map<string, { value: number; expiresAt: number }> };

  return mock;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KEY = '127.0.0.1';
const WINDOW_MS = 60_000;
const MAX = 3;
const NOW = new Date('2026-01-01T00:00:00.000Z').getTime();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RedisRateLimitStore', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // --- basic allow / deny --------------------------------------------------

  it('allows the first request and returns count 1', async () => {
    const redis = makeRedisMock();
    const store = new RedisRateLimitStore(redis);

    const decision = await store.consume(KEY, NOW, WINDOW_MS, MAX);

    expect(decision.allowed).toBe(true);
    expect(decision.count).toBe(1);
  });

  it('allows requests up to maxRequests', async () => {
    const redis = makeRedisMock();
    const store = new RedisRateLimitStore(redis);

    for (let i = 1; i <= MAX; i++) {
      const d = await store.consume(KEY, NOW, WINDOW_MS, MAX);
      expect(d.allowed).toBe(true);
      expect(d.count).toBe(i);
    }
  });

  it('denies the request when count exceeds maxRequests', async () => {
    const redis = makeRedisMock();
    const store = new RedisRateLimitStore(redis);

    for (let i = 0; i < MAX; i++) {
      await store.consume(KEY, NOW, WINDOW_MS, MAX);
    }

    const blocked = await store.consume(KEY, NOW, WINDOW_MS, MAX);
    expect(blocked.allowed).toBe(false);
    expect(blocked.count).toBe(MAX + 1);
  });

  // --- resetAt -------------------------------------------------------------

  it('sets resetAt to now + windowMs on the first request', async () => {
    const redis = makeRedisMock();
    const store = new RedisRateLimitStore(redis);

    const d = await store.consume(KEY, NOW, WINDOW_MS, MAX);

    expect(d.resetAt).toBe(NOW + WINDOW_MS);
  });

  it('resetAt shrinks as the window elapses', async () => {
    const redis = makeRedisMock();
    const store = new RedisRateLimitStore(redis);

    await store.consume(KEY, NOW, WINDOW_MS, MAX);

    const elapsed = 10_000;
    jest.advanceTimersByTime(elapsed);
    const now2 = Date.now();

    const d = await store.consume(KEY, now2, WINDOW_MS, MAX);
    // remaining ≈ WINDOW_MS - elapsed, so resetAt ≈ now2 + (WINDOW_MS - elapsed)
    expect(d.resetAt).toBeCloseTo(NOW + WINDOW_MS, -1);
  });

  // --- window reset --------------------------------------------------------

  it('resets the counter after the window expires', async () => {
    const redis = makeRedisMock();
    const store = new RedisRateLimitStore(redis);

    // Exhaust the limit.
    for (let i = 0; i < MAX; i++) {
      await store.consume(KEY, NOW, WINDOW_MS, MAX);
    }

    // Advance past the window so the key expires.
    jest.advanceTimersByTime(WINDOW_MS + 1);
    const now2 = Date.now();

    const d = await store.consume(KEY, now2, WINDOW_MS, MAX);
    expect(d.allowed).toBe(true);
    expect(d.count).toBe(1);
  });

  // --- key isolation -------------------------------------------------------

  it('tracks different keys independently', async () => {
    const redis = makeRedisMock();
    const store = new RedisRateLimitStore(redis);

    for (let i = 0; i < MAX; i++) {
      await store.consume('ip-A', NOW, WINDOW_MS, MAX);
    }

    // ip-A is exhausted; ip-B should be unaffected.
    const d = await store.consume('ip-B', NOW, WINDOW_MS, 1);
    expect(d.allowed).toBe(true);
    expect(d.count).toBe(1);
  });

  // --- key prefix ----------------------------------------------------------

  it('uses sep10:rl: as the default key prefix', async () => {
    const redis = makeRedisMock();
    const store = new RedisRateLimitStore(redis);

    await store.consume(KEY, NOW, WINDOW_MS, MAX);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      `sep10:rl:${KEY}`,
      String(WINDOW_MS),
    );
  });

  it('respects a custom key prefix', async () => {
    const redis = makeRedisMock();
    const store = new RedisRateLimitStore(redis, { keyPrefix: 'myapp:rl:' });

    await store.consume(KEY, NOW, WINDOW_MS, MAX);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      `myapp:rl:${KEY}`,
      String(WINDOW_MS),
    );
  });

  // --- Lua script forwarding -----------------------------------------------

  it('calls eval with numkeys=1', async () => {
    const redis = makeRedisMock();
    const store = new RedisRateLimitStore(redis);

    await store.consume(KEY, NOW, WINDOW_MS, MAX);

    const [, numkeys] = redis.eval.mock.calls[0];
    expect(numkeys).toBe(1);
  });

  it('passes windowMs as a string ARGV', async () => {
    const redis = makeRedisMock();
    const store = new RedisRateLimitStore(redis);

    await store.consume(KEY, NOW, WINDOW_MS, MAX);

    // args: script, numkeys, redisKey, windowMsStr
    const windowMsArg = redis.eval.mock.calls[0][3];
    expect(windowMsArg).toBe(String(WINDOW_MS));
  });

  // --- PTTL edge case ------------------------------------------------------

  it('falls back to windowMs for resetAt when PTTL returns a non-positive value', async () => {
    // Simulate a Redis that returns PTTL = -1 (key has no TTL — shouldn't
    // happen in normal use but the store must handle it gracefully).
    const redis: jest.Mocked<RedisEvalLike> = {
      eval: jest.fn().mockResolvedValue([1, -1]),
    };
    const store = new RedisRateLimitStore(redis);

    const d = await store.consume(KEY, NOW, WINDOW_MS, MAX);

    expect(d.resetAt).toBe(NOW + WINDOW_MS);
  });

  // --- integration with rateLimiter middleware ------------------------------

  it('integrates correctly as a store option for rateLimiter', async () => {
    const redis = makeRedisMock();
    const store = new RedisRateLimitStore(redis);
    const middleware = rateLimiter({ windowMs: WINDOW_MS, maxRequests: 1, store });

    function mockReq() {
      return {
        ip: KEY,
        socket: { remoteAddress: KEY },
        header: jest.fn(),
      } as unknown as import('express').Request;
    }

    function mockRes() {
      const r: Partial<import('express').Response> = {};
      r.status = jest.fn().mockReturnValue(r);
      r.json = jest.fn().mockReturnValue(r);
      r.set = jest.fn().mockReturnValue(r);
      return r as import('express').Response;
    }

    const next = jest.fn();

    // First request — allowed.
    const res1 = mockRes();
    middleware(mockReq(), res1, next);
    await Promise.resolve();
    await Promise.resolve();
    expect(next).toHaveBeenCalledTimes(1);

    // Second request — blocked.
    const res2 = mockRes();
    middleware(mockReq(), res2, next);
    await Promise.resolve();
    await Promise.resolve();
    expect(res2.status).toHaveBeenCalledWith(429);
    expect(next).toHaveBeenCalledTimes(1); // not called again
  });
});
