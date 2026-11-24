/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * @file sep10-auth/examples/redisRateLimitStore.ts
 *
 * A Redis-backed implementation of {@link RateLimitStore}.
 *
 * `InMemoryRateLimitStore` holds its sliding-window counters inside a single
 * process, so each replica of a horizontally-scaled service tracks its own
 * independent counters.  An attacker can exceed the intended limit simply by
 * round-robining across replicas.  `RedisRateLimitStore` solves this by
 * keeping the counters in a shared Redis instance that every replica reads
 * from and writes to.
 *
 * ## Algorithm
 *
 * The store uses an atomic Lua script evaluated with `EVAL`.  Within a single
 * script execution Redis serialises all reads and writes, so no two replicas
 * can race on the same key.  The script implements a **fixed-window** counter:
 *
 * ```
 * current = INCR key
 * if current == 1 then
 *   PEXPIRE key windowMs   -- set TTL only on the first increment
 * end
 * ttl = PTTL key
 * return { current, ttl }
 * ```
 *
 * On the first request inside a window the key is created and its TTL is set
 * to `windowMs` milliseconds.  Subsequent increments inside the same window
 * leave the TTL unchanged.  When the TTL elapses Redis removes the key
 * automatically, so the next request starts a fresh window.
 *
 * The script returns `[count, remainingMs]`, which map directly onto the
 * `RateLimitDecision` fields:
 *
 * | field      | value                                |
 * |------------|--------------------------------------|
 * | `allowed`  | `count <= maxRequests`               |
 * | `count`    | the INCR result                      |
 * | `resetAt`  | `now + remainingMs`                  |
 *
 * ## Usage
 *
 * Install a Redis client.  This example uses `ioredis`:
 *
 * ```bash
 * npm install ioredis
 * ```
 *
 * Wire it up alongside `rateLimiter`:
 *
 * ```ts
 * import Redis from 'ioredis';
 * import { rateLimiter } from 'sep10-auth';
 * import { RedisRateLimitStore } from './redisRateLimitStore';
 *
 * const redis = new Redis(process.env.REDIS_URL);
 * const store = new RedisRateLimitStore(redis);
 *
 * app.use('/api/challenge', rateLimiter({ windowMs: 60_000, maxRequests: 10, store }));
 * ```
 *
 * ## Dependency note
 *
 * `ioredis` is **not** a declared dependency of `sep10-auth`.  This file is
 * an example you copy into your own project.  The `RedisEvalLike` interface
 * is intentionally minimal so any Redis client that exposes an `eval` /
 * `evalsha`-compatible method can be used.
 */

import type { RateLimitStore, RateLimitDecision } from '../src/rate-limiter';

// ---------------------------------------------------------------------------
// Minimal Redis client interface
// ---------------------------------------------------------------------------

/**
 * The minimal subset of a Redis client that `RedisRateLimitStore` needs.
 *
 * Both ioredis and node-redis satisfy this out of the box:
 *
 * ```ts
 * // ioredis
 * import Redis from 'ioredis';
 * const redis = new Redis();
 * // redis.eval(script, numkeys, ...keys, ...args) → Promise<unknown>
 *
 * // node-redis (v4)
 * import { createClient } from 'redis';
 * const redis = createClient();
 * await redis.connect();
 * // wrap: { eval: (s, { keys, arguments }) => redis.eval(s, { keys, arguments }) }
 * ```
 */
export interface RedisEvalLike {
  /**
   * Evaluates a Lua script on the server.
   *
   * - `script`  — the Lua source
   * - `numkeys` — number of elements that follow which are KEYS
   * - `...args` — KEYS first, then ARGV values (all as strings)
   *
   * Returns the script's return value.  For this store the script always
   * returns a two-element array `[count, remainingMs]`.
   */
  eval(script: string, numkeys: number, ...args: string[]): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Lua script
// ---------------------------------------------------------------------------

/**
 * Atomic fixed-window counter.
 *
 * KEYS[1]  — the rate-limit key (e.g. `sep10:rl:127.0.0.1`)
 * ARGV[1]  — windowMs as a string (milliseconds)
 *
 * Returns `{count, remainingMs}` as a two-element Redis array reply.
 */
const INCR_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`.trim();

// ---------------------------------------------------------------------------
// RedisRateLimitStore
// ---------------------------------------------------------------------------

export interface RedisRateLimitStoreOptions {
  /**
   * Prefix applied to every key written to Redis.
   * Defaults to `"sep10:rl:"`.
   */
  keyPrefix?: string;
}

/**
 * Redis-backed {@link RateLimitStore}.
 *
 * Uses an atomic Lua script (INCR + PEXPIRE in one round-trip) so the counter
 * is always consistent regardless of how many app-server replicas share the
 * same Redis instance.
 */
export class RedisRateLimitStore implements RateLimitStore {
  private readonly redis: RedisEvalLike;
  private readonly keyPrefix: string;

  constructor(redis: RedisEvalLike, options: RedisRateLimitStoreOptions = {}) {
    this.redis = redis;
    this.keyPrefix = options.keyPrefix ?? 'sep10:rl:';
  }

  /**
   * Atomically increments the request counter for `key` within the current
   * window and returns a {@link RateLimitDecision}.
   *
   * The counter key expires automatically after `windowMs` milliseconds, so
   * no background sweep is needed.
   */
  async consume(
    key: string,
    now: number,
    windowMs: number,
    maxRequests: number,
  ): Promise<RateLimitDecision> {
    const redisKey = `${this.keyPrefix}${key}`;
    const result = await this.redis.eval(
      INCR_SCRIPT,
      1,
      redisKey,
      String(windowMs),
    );

    // The Lua script returns [count, remainingMs].
    // ioredis surfaces this as a plain JS array; node-redis also returns an array.
    const [count, remainingMs] = result as [number, number];

    // PTTL can return -1 (no TTL, shouldn't happen here) or -2 (key gone).
    // Fall back to windowMs if the TTL is unavailable.
    const effectiveRemaining = remainingMs > 0 ? remainingMs : windowMs;
    const resetAt = now + effectiveRemaining;

    return {
      allowed: count <= maxRequests,
      count,
      resetAt,
    };
  }
}
