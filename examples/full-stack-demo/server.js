const express = require('express');
const bodyParser = require('body-parser');
const { createSep10Middleware, generateChallenge } = require('sep10-auth');
const { HorizonListener, HttpWebhookSender, RpcEventSource } = require('horizon-listener');
const { MockSanctionsProvider, syncSanctionsToDenylist } = require('sanctions-oracle');
const { Keypair, Networks } = require('@stellar/stellar-sdk');

const app = express();
app.use(bodyParser.json());

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

app.post('/webhook/events', async (req, res) => {
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
      await new HttpWebhookSender({ url: WEBHOOK_URL }).send(event);
    } catch (sendError) {
      console.warn('Failed to send webhook event:', sendError);
    }
  },
  pollIntervalMs: 15000,
});

app.listen(3000, async () => {
  console.log('Full-stack demo listening on http://localhost:3000');
  console.log('Health check      -> GET /health');
  console.log('Public route      -> GET /public');
  console.log('Protected route   -> GET /private');
  console.log('Sanctions sync demo -> GET /sync');
  console.log('Challenge simulation -> GET /challenge');
  console.log('Starting HorizonListener...');
  try {
    await listener.start();
  } catch (err) {
    console.error('HorizonListener failed:', err);
  }
});
