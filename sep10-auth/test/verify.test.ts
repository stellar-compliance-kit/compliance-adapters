import { Keypair, Networks, Transaction } from '@stellar/stellar-sdk';
import { generateChallenge } from '../src/challenge';
import { verifyChallenge } from '../src/verify';

const homeDomain = 'localhost:3000';

function signAsClient(
  transactionXDR: string,
  networkPassphrase: string,
  clientKeypair: Keypair,
): string {
  const tx = new Transaction(transactionXDR, networkPassphrase);
  tx.sign(clientKeypair);
  return tx.toXDR();
}

describe('verifyChallenge', () => {
  it('accepts a challenge signed by the client', () => {
    const serverKeypair = Keypair.random();
    const clientKeypair = Keypair.random();

    const challenge = generateChallenge(clientKeypair.publicKey(), serverKeypair, {
      homeDomain,
      webAuthDomain: homeDomain,
      networkPassphrase: Networks.TESTNET,
    });

    const signedXDR = signAsClient(challenge.transactionXDR, Networks.TESTNET, clientKeypair);

    const result = verifyChallenge(signedXDR, {
      serverAccountId: serverKeypair.publicKey(),
      networkPassphrase: Networks.TESTNET,
      homeDomains: homeDomain,
      webAuthDomain: homeDomain,
    });

    expect(result.valid).toBe(true);
    expect(result.address).toBe(clientKeypair.publicKey());
    expect(result.error).toBeUndefined();
  });

  it('rejects a challenge whose timebounds have expired', () => {
    // buildChallengeTx always sets minTime to the real "now" at build time, so
    // an already-expired transaction can't be constructed with a negative
    // timeout (minTime would end up after maxTime and the SDK rejects that
    // outright). The SDK's readChallengeTx also applies a fixed 300s grace
    // period on top of the transaction's own maxTime (Utils.validateTimebounds
    // (tx, 60 * 5)), so real-time expiry would mean sleeping 5+ minutes in the
    // test. Fake timers let us fast-forward Date.now() past both the
    // challenge's short timeout and that grace window instead.
    jest.useFakeTimers();
    try {
      const serverKeypair = Keypair.random();
      const clientKeypair = Keypair.random();

      const challenge = generateChallenge(clientKeypair.publicKey(), serverKeypair, {
        homeDomain,
        webAuthDomain: homeDomain,
        networkPassphrase: Networks.TESTNET,
        timeoutSeconds: 1,
      });

      const signedXDR = signAsClient(challenge.transactionXDR, Networks.TESTNET, clientKeypair);

      jest.advanceTimersByTime((1 + 301) * 1000);

      const result = verifyChallenge(signedXDR, {
        serverAccountId: serverKeypair.publicKey(),
        networkPassphrase: Networks.TESTNET,
        homeDomains: homeDomain,
        webAuthDomain: homeDomain,
      });

      expect(result.valid).toBe(false);
      expect(result.address).toBe('');
      expect(result.error).toMatch(/expired|timebounds/i);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects a challenge verified against the wrong network passphrase', () => {
    const serverKeypair = Keypair.random();
    const clientKeypair = Keypair.random();

    const challenge = generateChallenge(clientKeypair.publicKey(), serverKeypair, {
      homeDomain,
      webAuthDomain: homeDomain,
      networkPassphrase: Networks.TESTNET,
    });

    const signedXDR = signAsClient(challenge.transactionXDR, Networks.TESTNET, clientKeypair);

    const result = verifyChallenge(signedXDR, {
      serverAccountId: serverKeypair.publicKey(),
      networkPassphrase: Networks.PUBLIC,
      homeDomains: homeDomain,
      webAuthDomain: homeDomain,
    });

    expect(result.valid).toBe(false);
    expect(result.address).toBe('');
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/network|passphrase|hash|signed|server/i);
  });

  it('rejects a challenge the client never signed', () => {
    const serverKeypair = Keypair.random();
    const clientKeypair = Keypair.random();

    const challenge = generateChallenge(clientKeypair.publicKey(), serverKeypair, {
      homeDomain,
      webAuthDomain: homeDomain,
      networkPassphrase: Networks.TESTNET,
    });

    const result = verifyChallenge(challenge.transactionXDR, {
      serverAccountId: serverKeypair.publicKey(),
      networkPassphrase: Networks.TESTNET,
      homeDomains: homeDomain,
      webAuthDomain: homeDomain,
    });

    expect(result.valid).toBe(false);
    expect(result.address).toBe('');
    expect(result.error).toBeDefined();
  });
});
