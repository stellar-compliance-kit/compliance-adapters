import express from 'express';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import { generateChallenge, createSep10Middleware } from '../../src';

// Demo-only server keypair. A real deployment loads this from a secret store
// (e.g. process.env.SEP10_SERVER_SECRET) and keeps it stable across restarts,
// since the public key is the server account clients authenticate against.
const serverKeypair = Keypair.random();

const HOME_DOMAIN = 'example.com';
const WEB_AUTH_DOMAIN = 'example.com';
const NETWORK_PASSPHRASE = Networks.TESTNET;

const app = express();
app.use(express.json());

// Step 1: client requests a challenge transaction for its address to sign.
app.get('/challenge', (req, res) => {
  const clientAddress = req.query.address;

  if (typeof clientAddress !== 'string' || !clientAddress) {
    res.status(400).json({ error: 'missing required "address" query parameter' });
    return;
  }

  const challenge = generateChallenge(clientAddress, serverKeypair, {
    homeDomain: HOME_DOMAIN,
    webAuthDomain: WEB_AUTH_DOMAIN,
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  res.json({
    transaction: challenge.transactionXDR,
    network_passphrase: challenge.networkPassphrase,
  });
});

// Step 2: client signs the challenge with its own wallet and sends the signed
// XDR back as a bearer token on any protected route.
app.get(
  '/protected',
  createSep10Middleware({
    serverAccountId: serverKeypair.publicKey(),
    networkPassphrase: NETWORK_PASSPHRASE,
    homeDomains: HOME_DOMAIN,
    webAuthDomain: WEB_AUTH_DOMAIN,
  }),
  (req, res) => {
    res.json({ address: req.stellarAddress });
  },
);

const PORT = process.env.PORT ?? 3000;

app.listen(PORT, () => {
  console.log(`SEP-10 example app listening on http://localhost:${PORT}`);
  console.log(`Server account: ${serverKeypair.publicKey()}`);
});
