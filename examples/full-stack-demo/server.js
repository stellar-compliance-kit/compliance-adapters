/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

const express = require('express');
const { createHmac, timingSafeEqual } = require('node:crypto');
const { createSep10Middleware, generateChallenge } = require('sep10-auth');
const { HorizonListener, HttpWebhookSender, RpcEventSource } = require('horizon-listener');
const { MockSanctionsProvider, syncSanctionsToDenylist } = require('sanctions-oracle');
const { Keypair, Networks } = require('@stellar/stellar-sdk');

// ---------------------------------------------------------------------------
// Webhook signature verification helpers
// ---------------------------------------------------------------------------

// Tolerates delivery latency + retry backoff while bounding replay windows.
const MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60;

/**
 * Returns true when the X-Timestamp header value represents a Unix timestamp
 * that falls within MAX_TIMESTAMP_SKEW_SECONDS of now.
 *
 * @param {string | undefined} timestampHeader
 * @returns {boolean}
 */
function isFreshTimestamp(timestampHeader) {
  if (!timestampHeader || !/^\d+$/.test(timestampHeader)) return false;
  const skewSeconds = Math.abs(Date.now() / 1000 - Number(timestampHeader));
  return skewSeconds <= MAX_TIMESTAMP_SKEW_SECONDS;
}

/**
 * Recomputes the HMAC-SHA256 over `<X-Timestamp>.<rawBody>` using
 * WEBHOOK_SIGNING_SECRET and compares it to the X-Signature header value
 * with a constant-time comparison to prevent timing-oracle attacks.
 *
 * The HMAC must be computed over the *raw* request bytes — not a
 * re-serialised version of the parsed body — because key order or whitespace
 * differences would produce a different digest.
 *
 * @param {Buffer} rawBody  The exact bytes received over the wire.
 * @param {string | undefined} timestampHeader  Value of X-Timestamp header.
 * @param {string | undefined} signatureHeader  Value of X-Signature header.
 * @param {string} secret  Shared HMAC signing secret.
 * @returns {boolean}
 */
function isValidSignature(rawBody, timestampHeader, signatureHeader, secret) {
  if (!timestampHeader || !signatureHeader) return false;

  // Reconstruct the exact signed material: "<timestamp>.<raw body>".
  const signedMaterial = Buffer.concat([Buffer.from(`${timestampHeader}.`), rawBody]);
  const expected = createHmac('sha256', secret).update(signedMaterial).digest('hex');
  const expectedHeader = `sha256=${expected}`;

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expectedHeader);
  // Lengths must match before timingSafeEqual (it throws if they differ).
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = express();

// Replace body-parser with express.json so we can attach the raw body Buffer
// to each request before JSON parsing.  The rawBody is required to verify
// HMAC signatures — re-serialising req.body would lose key order / whitespace.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

// The server keypair signs SEP-10 challenge transactions in /challenge; its
// public key must match SERVER_ACCOUNT_ID, which the middleware uses to
// verify those same challenges in /private. Set SERVER_SECRET_KEY to a
// stable value in any environment other than local dev.
const SERVER_SECRET_KEY = process.env.SERVER_SECRET_KEY;
let serverKeypair;
if (SERVER_SECRET_KEY) {
  serverKeypair = Keypair.fromSecret(SERVER_SECRET_KEY);
} else {
  serverKeypair = Keypair.random();
  console.warn(
    'SERVER_SECRET_KEY not set; using an ephemeral in-memory keypair for local development only. ' +
      'This key is regenerated on every restart. Set SERVER_SECRET_KEY for a stable server identity.',
  );
}

const SERVER_ACCOUNT_ID = process.env.SERVER_ACCOUNT_ID || serverKeypair.publicKey();
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
const HOME_DOMAIN = process.env.HOME_DOMAIN || 'localhost:3000';
const WEB_AUTH_DOMAIN = process.env.WEB_AUTH_DOMAIN || 'localhost:3000';
const CONTRACT_ID = process.env.CONTRACT_ID || 'GDUMMYCONTRACTID000000000000000000000000000';
const RPC_URL = process.env.RPC_URL || 'https://horizon-testnet.stellar.org';
const START_LEDGER = Number(process.env.START_LEDGER || '0');

// ---------------------------------------------------------------------------
// WEBHOOK_SIGNING_SECRET controls whether signature verification is enforced.
//
// When set, every inbound /webhook/events request must carry valid X-Timestamp
// and X-Signature headers (as produced by HttpWebhookSender's signingSecret).
// Requests without those headers, with an invalid HMAC, or whose timestamp
// falls outside the freshness window are rejected with 401.
//
// When left unset, the handler falls back to the old behaviour (no signature
// check) so the demo remains runnable without any extra configuration.
// ---------------------------------------------------------------------------
const WEBHOOK_SIGNING_SECRET = process.env.WEBHOOK_SIGNING_SECRET;

const sep10Middleware = createSep10Middleware({
  serverAccountId: SERVER_ACCOUNT_ID,
  networkPassphrase: NETWORK_PASSPHRASE,
  homeDomains: [HOME_DOMAIN],
  webAuthDomain: WEB_AUTH_DOMAIN,
});

// Unauthenticated health-check for container orchestrator liveness/readiness
// probes and load balancer health checks.  Registered before any auth middleware.
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/public', (req, res) => {
  res.json({ message: 'public route' });
});

app.get('/private', sep10Middleware, (req, res) => {
  res.json({ message: 'authenticated', address: req.stellarAddress });
});

/**
 * POST /webhook/events
 *
 * Receives contract events forwarded by HorizonListener's HttpWebhookSender.
 *
 * When WEBHOOK_SIGNING_SECRET is set, the handler verifies:
 *   1. X-Timestamp is present and within the freshness window (5 min).
 *   2. X-Signature matches the HMAC-SHA256 of "<X-Timestamp>.<raw body>"
 *      using timingSafeEqual so the comparison cannot be short-circuited.
 *
 * Requests that fail either check are rejected with 401.  This matches the
 * recipe documented in horizon-listener/README.md and ensures that the
 * reference example stays in lockstep with the real HttpWebhookSender
 * implementation (CI will catch any drift).
 */
app.post('/webhook/events', (req, res) => {
  if (WEBHOOK_SIGNING_SECRET) {
    const rawBody = req.rawBody ?? Buffer.alloc(0);
    const timestampHeader = req.headers['x-timestamp'];
    const signatureHeader = req.headers['x-signature'];

    if (
      !isFreshTimestamp(timestampHeader) ||
      !isValidSignature(rawBody, timestampHeader, signatureHeader, WEBHOOK_SIGNING_SECRET)
    ) {
      return res.status(401).json({ error: 'invalid or missing webhook signature' });
    }
  }

  const event = req.body.event;
  console.log('Received horizon event webhook:', event);
  res.status(200).json({ received: true, event });
});

app.get('/sync', async (req, res) => {
  const mockProvider = new MockSanctionsProvider();
  const addresses = [
    'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  ];

  const result = await syncSanctionsToDenylist({
    provider: mockProvider,
    addresses,
    writer: {
      async addToDenylist(address) {
        console.log('mock writer addToDenylist:', address);
        return { hash: `mock-hash-${address}` };
      },
    },
    dryRun: true,
  });

  res.json(result);
});

app.get('/challenge', (req, res) => {
  const clientKeypair = Keypair.random();
  const challenge = generateChallenge(clientKeypair.publicKey(), serverKeypair, {
    homeDomain: HOME_DOMAIN,
    webAuthDomain: WEB_AUTH_DOMAIN,
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  res.json({ ...challenge, address: clientKeypair.publicKey() });
});

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3000/webhook/events';
const listener = new HorizonListener({
  eventSource: new RpcEventSource({
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    contractIds: [CONTRACT_ID],
    startLedger: START_LEDGER,
  }),
  onEvent: async (event) => {
    console.log('HorizonListener event:', event);

    const addresses =
      typeof event.value === 'string' && event.value.length > 0
        ? [event.value]
        : [
            'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
            'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          ];

    const syncResult = await syncSanctionsToDenylist({
      provider: new MockSanctionsProvider(),
      addresses,
      writer: {
        async addToDenylist(address) {
          console.log('sanctions-oracle writer sending denylist write for:', address);
          return { hash: `mock-hash-${address}` };
        },
      },
      dryRun: true,
    });

    console.log('sanctions-oracle sync result:', syncResult);

    try {
      await new HttpWebhookSender({
        url: WEBHOOK_URL,
        // Mirror WEBHOOK_SIGNING_SECRET into the sender so the self-referential
        // demo loop (listener → /webhook/events) always passes signature verification.
        signingSecret: WEBHOOK_SIGNING_SECRET,
      }).send(event);
    } catch (sendError) {
      console.warn('Failed to send webhook event:', sendError);
    }
  },
  pollIntervalMs: 15000,
});

// Only bind the port when running as the main entry point, not when required
// by tests.  This mirrors the common Node.js idiom for testable servers.
if (require.main === module) {
  app.listen(3000, async () => {
    console.log('Full-stack demo listening on http://localhost:3000');
    console.log('Health check         -> GET  /health');
    console.log('Public route         -> GET  /public');
    console.log('Protected route      -> GET  /private');
    console.log('Webhook events       -> POST /webhook/events');
    console.log('Sanctions sync demo  -> GET  /sync');
    console.log('Challenge simulation -> GET  /challenge');
    if (WEBHOOK_SIGNING_SECRET) {
      console.log('Webhook signature verification: ENABLED');
    } else {
      console.warn(
        'WEBHOOK_SIGNING_SECRET not set; webhook signature verification is DISABLED. ' +
          'Set this variable to enforce HMAC verification in production.',
      );
    }
    console.log('Starting HorizonListener...');
    try {
      await listener.start();
    } catch (err) {
      console.error('HorizonListener failed:', err);
    }
  });
}

module.exports = { app, isFreshTimestamp, isValidSignature };
