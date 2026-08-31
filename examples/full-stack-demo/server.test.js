'use strict';

/**
 * Tests for the full-stack-demo server's webhook signature verification logic
 * and the /health endpoint.
 *
 * Strategy: jest.config.js maps all unbuilt workspace packages to lightweight
 * stubs in __mocks__/, so the test suite has no network dependency and can run
 * in any CI environment without a full monorepo build.
 *
 * The signing helpers (isFreshTimestamp, isValidSignature) are unit-tested
 * directly, and the /webhook/events route is integration-tested via supertest.
 */

const { createHmac } = require('node:crypto');
const request = require('supertest');

// ---------------------------------------------------------------------------
// Helpers to build valid signatures (mirrors HttpWebhookSender.sign())
// ---------------------------------------------------------------------------

const TEST_SECRET = 'test-signing-secret-for-jest';

/**
 * Produce an X-Signature value matching the one HttpWebhookSender would send.
 *
 * @param {string} timestamp  Unix seconds string.
 * @param {string} body       Raw JSON body string.
 * @param {string} [secret]   Signing secret; defaults to TEST_SECRET.
 * @returns {string}  e.g. "sha256=<hex>"
 */
function makeSignature(timestamp, body, secret = TEST_SECRET) {
  const hex = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `sha256=${hex}`;
}

/**
 * Returns a Unix seconds string representing now (optionally offset).
 *
 * @param {number} offsetSeconds
 * @returns {string}
 */
function nowTimestamp(offsetSeconds = 0) {
  return String(Math.floor(Date.now() / 1000) + offsetSeconds);
}

// ---------------------------------------------------------------------------
// Require the server module with WEBHOOK_SIGNING_SECRET set.
// We set the env var before require() so server.js picks it up at module load.
// ---------------------------------------------------------------------------
process.env.WEBHOOK_SIGNING_SECRET = TEST_SECRET;

const { app, isFreshTimestamp, isValidSignature } = require('./server');

// ---------------------------------------------------------------------------
// Unit tests: isFreshTimestamp
// ---------------------------------------------------------------------------
describe('isFreshTimestamp()', () => {
  it('returns true for a timestamp equal to now', () => {
    expect(isFreshTimestamp(nowTimestamp())).toBe(true);
  });

  it('returns true for a timestamp 1 second in the past', () => {
    expect(isFreshTimestamp(nowTimestamp(-1))).toBe(true);
  });

  it('returns true for a timestamp at the edge of the 5-minute window', () => {
    expect(isFreshTimestamp(nowTimestamp(-299))).toBe(true);
  });

  it('returns false for a timestamp older than 5 minutes', () => {
    expect(isFreshTimestamp(nowTimestamp(-301))).toBe(false);
  });

  it('returns false for a future timestamp beyond the 5-minute window', () => {
    expect(isFreshTimestamp(nowTimestamp(301))).toBe(false);
  });

  it('returns false when the header is undefined', () => {
    expect(isFreshTimestamp(undefined)).toBe(false);
  });

  it('returns false when the header is an empty string', () => {
    expect(isFreshTimestamp('')).toBe(false);
  });

  it('returns false for a non-numeric string', () => {
    expect(isFreshTimestamp('not-a-number')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit tests: isValidSignature
// ---------------------------------------------------------------------------
describe('isValidSignature()', () => {
  const body = JSON.stringify({ event: { id: 'evt-1', type: 'AddedToDenylist' } });
  const rawBody = Buffer.from(body);

  it('returns true for a correct HMAC', () => {
    const ts = nowTimestamp();
    const sig = makeSignature(ts, body);
    expect(isValidSignature(rawBody, ts, sig, TEST_SECRET)).toBe(true);
  });

  it('returns false when the signature is wrong', () => {
    const ts = nowTimestamp();
    expect(isValidSignature(rawBody, ts, 'sha256=deadbeef', TEST_SECRET)).toBe(false);
  });

  it('returns false when the body was tampered', () => {
    const ts = nowTimestamp();
    const sig = makeSignature(ts, body);
    const tamperedBody = Buffer.from(JSON.stringify({ event: { id: 'evt-2' } }));
    expect(isValidSignature(tamperedBody, ts, sig, TEST_SECRET)).toBe(false);
  });

  it('returns false when the secret is wrong', () => {
    const ts = nowTimestamp();
    const sig = makeSignature(ts, body, 'wrong-secret');
    expect(isValidSignature(rawBody, ts, sig, TEST_SECRET)).toBe(false);
  });

  it('returns false when X-Timestamp is missing', () => {
    const sig = makeSignature(nowTimestamp(), body);
    expect(isValidSignature(rawBody, undefined, sig, TEST_SECRET)).toBe(false);
  });

  it('returns false when X-Signature is missing', () => {
    const ts = nowTimestamp();
    expect(isValidSignature(rawBody, ts, undefined, TEST_SECRET)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration tests: GET /health
// ---------------------------------------------------------------------------
describe('GET /health', () => {
  it('returns 200 with { status: ok } without any headers', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

// ---------------------------------------------------------------------------
// Integration tests: POST /webhook/events  (signature verification enforced)
// ---------------------------------------------------------------------------
describe('POST /webhook/events', () => {
  const eventPayload = { event: { id: 'evt-abc', type: 'AddedToDenylist', value: 'GSOME...' } };
  const bodyString = JSON.stringify(eventPayload);

  it('returns 200 when X-Timestamp and X-Signature are valid', async () => {
    const ts = nowTimestamp();
    const sig = makeSignature(ts, bodyString);

    const res = await request(app)
      .post('/webhook/events')
      .set('Content-Type', 'application/json')
      .set('X-Timestamp', ts)
      .set('X-Signature', sig)
      .send(bodyString);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('returns 401 when X-Signature header is missing', async () => {
    const ts = nowTimestamp();

    const res = await request(app)
      .post('/webhook/events')
      .set('Content-Type', 'application/json')
      .set('X-Timestamp', ts)
      .send(bodyString);

    expect(res.status).toBe(401);
  });

  it('returns 401 when X-Timestamp header is missing', async () => {
    const sig = makeSignature(nowTimestamp(), bodyString);

    const res = await request(app)
      .post('/webhook/events')
      .set('Content-Type', 'application/json')
      .set('X-Signature', sig)
      .send(bodyString);

    expect(res.status).toBe(401);
  });

  it('returns 401 when X-Signature is wrong', async () => {
    const ts = nowTimestamp();

    const res = await request(app)
      .post('/webhook/events')
      .set('Content-Type', 'application/json')
      .set('X-Timestamp', ts)
      .set('X-Signature', 'sha256=0000000000000000000000000000000000000000000000000000000000000000')
      .send(bodyString);

    expect(res.status).toBe(401);
  });

  it('returns 401 when the timestamp is stale (replayed request)', async () => {
    // Timestamp 10 minutes in the past — outside the 5-minute freshness window.
    const staleTs = nowTimestamp(-601);
    const sig = makeSignature(staleTs, bodyString);

    const res = await request(app)
      .post('/webhook/events')
      .set('Content-Type', 'application/json')
      .set('X-Timestamp', staleTs)
      .set('X-Signature', sig)
      .send(bodyString);

    expect(res.status).toBe(401);
  });

  it('returns 401 when the body is different from what was signed', async () => {
    const ts = nowTimestamp();
    // Sign a different body but send the real eventPayload body.
    const sig = makeSignature(ts, JSON.stringify({ event: { id: 'different' } }));

    const res = await request(app)
      .post('/webhook/events')
      .set('Content-Type', 'application/json')
      .set('X-Timestamp', ts)
      .set('X-Signature', sig)
      .send(bodyString);

    expect(res.status).toBe(401);
  });

  it('returns 401 when no signature headers are sent', async () => {
    const res = await request(app)
      .post('/webhook/events')
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBe(401);
  });
});
