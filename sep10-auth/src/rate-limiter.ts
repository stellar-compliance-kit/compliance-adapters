import { RequestHandler } from 'express';

export interface RateLimiterOptions {
  windowMs?: number;
  maxRequests?: number;
  keyGenerator?: (req: import('express').Request) => string;
}

interface RateLimitEntry {
  timestamps: number[];
  timeout: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_WINDOW_MS = 60_000; // 1 minute
const DEFAULT_MAX_REQUESTS = 100;

function defaultKeyGenerator(req: import('express').Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/**
 * Creates an Express middleware that rate-limits incoming requests.
 *
 * Uses a simple in-memory sliding-window counter keyed by client IP (or a
 * custom key generator). Old entries are pruned lazily when the window
 * expires — no external store (Redis, etc.) is required.
 *
 * When the limit is exceeded the middleware responds with **429**
 * and a JSON body:
 *
 * ```json
 * { "error": "rate_limit_exceeded", "retryAfter": <seconds> }
 * ```
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { rateLimiter } from 'sep10-auth';
 *
 * const app = express();
 *
 * // 10 requests per 30 seconds
 * app.use('/api/challenge', rateLimiter({ windowMs: 30_000, maxRequests: 10 }));
 * ```
 */
export function rateLimiter(options: RateLimiterOptions = {}): RequestHandler {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const keyFn = options.keyGenerator ?? defaultKeyGenerator;

  // Using a plain object instead of Map so that the store can be inspected
  // from tests (no private symbol issues).
  const store = new Map<string, RateLimitEntry>();

  // Periodic sweep — every windowMs we discard stale entries so the store
  // doesn't grow unbounded under heavy traffic.
  const sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);
      if (entry.timestamps.length === 0) {
        if (entry.timeout) clearTimeout(entry.timeout);
        store.delete(key);
      }
    }
  }, windowMs);

  // Allow the timer to keep the process alive (like a keepAlive timer).
  if (sweepTimer.unref) {
    sweepTimer.unref();
  }

  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();

    let entry = store.get(key);
    if (!entry) {
      entry = { timestamps: [], timeout: null };
      store.set(key, entry);
    }

    // Remove timestamps that have fallen out of the window.
    entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

    if (entry.timestamps.length >= maxRequests) {
      const oldest = entry.timestamps[0];
      const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);

      res
        .status(429)
        .set('Retry-After', String(retryAfter))
        .json({ error: 'rate_limit_exceeded', retryAfter });
      return;
    }

    entry.timestamps.push(now);
    next();
  };
}
