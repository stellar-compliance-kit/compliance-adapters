import express from 'express';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import { generateChallenge, createSep10Middleware } from '../../src';

export interface ExampleAppOptions {
  /**
   * Server keypair used to sign challenge transactions. A real deployment loads
   * this from a secret store and keeps it stable across restarts, since the
   * public key is the server account clients authenticate against. Defaults to
   * a fresh random keypair — fine for a demo, not for a deployment.
   */
  serverKeypair?: Keypair;
  homeDomain?: string;
  webAuthDomain?: string;
  networkPassphrase?: string;
}

export interface ExampleApp {
  app: express.Express;
  serverKeypair: Keypair;
}

/**
 * Build the SEP-10 example Express app without binding to a port.
 *
 * Keeping app construction separate from server startup (see `server.ts`) makes
 * the routes testable with supertest — mirroring the `createApp()` pattern used
 * by `examples/sep10-sanctions-gate`.
 */
export function createApp(options: ExampleAppOptions = {}): ExampleApp {
  const serverKeypair = options.serverKeypair ?? Keypair.random();
  const homeDomain = options.homeDomain ?? 'example.com';
  const webAuthDomain = options.webAuthDomain ?? homeDomain;
  const networkPassphrase = options.networkPassphrase ?? Networks.TESTNET;

  const app = express();
  app.use(express.json());

  // Step 1: client requests a challenge transaction for its address to sign.
  app.get('/challenge', (req, res) => {
    const clientAddress = req.query.address;

    if (typeof clientAddress !== 'string' || !clientAddress) {
      res.status(400).json({ error: 'missing required "address" query parameter' });
      return;
    }

    try {
      const challenge = generateChallenge(clientAddress, serverKeypair, {
        homeDomain,
        webAuthDomain,
        networkPassphrase,
      });

      res.json({
        transaction: challenge.transactionXDR,
        network_passphrase: challenge.networkPassphrase,
      });
    } catch {
      res.status(400).json({ error: 'invalid "address" query parameter' });
    }
  });

  // Step 2: client signs the challenge with its own wallet and sends the signed
  // XDR back as a bearer token on any protected route.
  app.get(
    '/protected',
    createSep10Middleware({
      serverAccountId: serverKeypair.publicKey(),
      networkPassphrase,
      homeDomains: homeDomain,
      webAuthDomain,
    }),
    (req, res) => {
      res.json({ address: req.stellarAddress });
    },
  );

  return { app, serverKeypair };
}
