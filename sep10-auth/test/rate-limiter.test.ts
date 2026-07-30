///<reference types="jest" />
import { Request, Response, NextFunction } from 'express';
import { rateLimiter, RateLimiterOptions } from '../src/rate-limiter';

function mockRequest(overrides: Partial<Request> = {}): Request {
  return {
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' } as any,
    header: jest.fn(),
    ...overrides,
  } as unknown as Request;
}

function mockResponse(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('rateLimiter', () => {
  let req: Request;
  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    req = mockRequest();
    res = mockResponse();
    next = jest.fn();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows requests under the limit', () => {
    const middleware = rateLimiter({ windowMs: 60_000, maxRequests: 5 });

    for (let i = 0; i < 5; i++) {
      middleware(req, res, next);
    }

    expect(next).toHaveBeenCalledTimes(5);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks requests that exceed the limit and returns 429', () => {
    const middleware = rateLimiter({ windowMs: 60_000, maxRequests: 3 });

    for (let i = 0; i < 3; i++) {
      middleware(req, res, next);
    }

    expect(next).toHaveBeenCalledTimes(3);

    // 4th request — should be blocked
    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'rate_limit_exceeded' }),
    );
    expect(next).toHaveBeenCalledTimes(3); // next not called for blocked request
  });

  it('includes retryAfter in the 429 response', () => {
    const middleware = rateLimiter({ windowMs: 60_000, maxRequests: 1 });

    middleware(req, res, next); // 1st — ok
    middleware(req, res, next); // 2nd — blocked

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'rate_limit_exceeded',
        retryAfter: expect.any(Number),
      }),
    );
    expect(res.set).toHaveBeenCalledWith(
      'Retry-After',
      expect.any(String),
    );
  });

  it('resets the counter after the window expires', () => {
    const middleware = rateLimiter({ windowMs: 60_000, maxRequests: 1 });

    middleware(req, res, next); // 1st — ok
    expect(next).toHaveBeenCalledTimes(1);

    // Advance past the window
    jest.advanceTimersByTime(60_001);

    middleware(req, res, next); // 2nd — should be allowed again

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('uses a custom key generator when provided', () => {
    const keyGenerator = jest.fn().mockReturnValue('custom-key');
    const middleware = rateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
      keyGenerator,
    });

    middleware(req, res, next); // 1st — ok
    expect(keyGenerator).toHaveBeenCalledWith(req);

    middleware(req, res, next); // 2nd — blocked for same custom key
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('isolates rate limit counters by custom key', () => {
    let keyCounter = 0;
    const keyGenerator = jest.fn(() => `user-${keyCounter++ % 2}`);
    const middleware = rateLimiter({
      windowMs: 60_000,
      maxRequests: 2,
      keyGenerator,
    });

    // user-0: two requests allowed
    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(2);

    // user-1: two requests allowed (different key — separate counter)
    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(3);

    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(4);

    // user-0 again (3rd request) — blocked
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(next).toHaveBeenCalledTimes(4); // no change
  });

  it('falls back to socket remoteAddress when ip is not set', () => {
    const noIpReq = mockRequest({ ip: undefined });
    const middleware = rateLimiter({ windowMs: 60_000, maxRequests: 1 });

    middleware(noIpReq, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('applies default options when none are provided', () => {
    const middleware = rateLimiter();

    // 100 requests should all be allowed with default max
    for (let i = 0; i < 100; i++) {
      middleware(req, res, next);
    }

    expect(next).toHaveBeenCalledTimes(100);

    // 101st should be blocked
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
  });
});
