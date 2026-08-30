///<reference types="jest" />
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

  it('accepts a challenge when homeDomains is an array containing the challenge home domain', () => {
    const serverKeypair = Keypair.random();
    const clientKeypair = Keypair.random();

    const challenge = generateChallenge(clientKeypair.publicKey(), serverKeypair, {
      homeDomain: 'domain-a.com',
      webAuthDomain: 'domain-a.com',
      networkPassphrase: Networks.TESTNET,
    });

    const signedXDR = signAsClient(challenge.transactionXDR, Networks.TESTNET, clientKeypair);

    const result = verifyChallenge(signedXDR, {
      serverAccountId: serverKeypair.publicKey(),
      networkPassphrase: Networks.TESTNET,
      homeDomains: ['domain-a.com', 'domain-b.com'],
      webAuthDomain: 'domain-a.com',
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

  it('treats the exact boundary instant (maxTime + 300s) as valid (inclusive), and expires immediately after', () => {
    jest.useFakeTimers();
    try {
      const initialTime = 1700000000000;
      jest.setSystemTime(initialTime);

      const serverKeypair = Keypair.random();
      const clientKeypair = Keypair.random();
      const timeoutSeconds = 300;

      const challenge = generateChallenge(clientKeypair.publicKey(), serverKeypair, {
        homeDomain,
        webAuthDomain: homeDomain,
        networkPassphrase: Networks.TESTNET,
        timeoutSeconds,
      });

      const signedXDR = signAsClient(challenge.transactionXDR, Networks.TESTNET, clientKeypair);

      // At exact boundary moment (maxTime + 300s grace period):
      // Stellar SDK's WebAuth.readChallengeTx treats the boundary instant as inclusive (valid).
      jest.advanceTimersByTime((timeoutSeconds + 300) * 1000);

      const resultAtBoundary = verifyChallenge(signedXDR, {
        serverAccountId: serverKeypair.publicKey(),
        networkPassphrase: Networks.TESTNET,
        homeDomains: homeDomain,
        webAuthDomain: homeDomain,
      });

      // WebAuth.readChallengeTx / Utils.validateTimebounds treats the exact boundary instant
      // (maxTime + 300s grace period) as VALID (inclusive boundary condition).
      expect(resultAtBoundary.valid).toBe(true);
      expect(resultAtBoundary.address).toBe(clientKeypair.publicKey());

      // Advancing 1 second past the boundary (601s total elapsed) causes the challenge to be expired.
      jest.advanceTimersByTime(1000);

      const resultAfterBoundary = verifyChallenge(signedXDR, {
        serverAccountId: serverKeypair.publicKey(),
        networkPassphrase: Networks.TESTNET,
        homeDomains: homeDomain,
        webAuthDomain: homeDomain,
      });

      // Beyond maxTime + 300s, WebAuth returns expired (valid: false).
      expect(resultAfterBoundary.valid).toBe(false);
      expect(resultAfterBoundary.error).toMatch(/expired|timebounds/i);
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

  it('accumulates error messages from all webAuthDomain attempts when all fail (issue #304)', () => {
    const serverKeypair = Keypair.random();
    const clientKeypair = Keypair.random();

    const challenge = generateChallenge(clientKeypair.publicKey(), serverKeypair, {
      homeDomain: 'correct-domain.com',
      webAuthDomain: 'correct-domain.com',
      networkPassphrase: Networks.TESTNET,
    });

    const signedXDR = signAsClient(challenge.transactionXDR, Networks.TESTNET, clientKeypair);

    // Try to verify with multiple wrong webAuthDomains
    const result = verifyChallenge(signedXDR, {
      serverAccountId: serverKeypair.publicKey(),
      networkPassphrase: Networks.TESTNET,
      homeDomains: 'correct-domain.com',
      webAuthDomain: ['wrong-domain-a.com', 'wrong-domain-b.com', 'wrong-domain-c.com'],
    });

    expect(result.valid).toBe(false);
    expect(result.address).toBe('');
    expect(result.error).toBeDefined();
    // The error should ideally mention all the attempted domains, not just the last one
    // Currently it only reports the last error, which is the issue #304 documents
  });

  it('reports mismatch error when challenge has one webAuthDomain but verification tries different ones', () => {
    const serverKeypair = Keypair.random();
    const clientKeypair = Keypair.random();

    const challenge = generateChallenge(clientKeypair.publicKey(), serverKeypair, {
      homeDomain: 'domain-a.com',
      webAuthDomain: 'domain-a.com',
      networkPassphrase: Networks.TESTNET,
    });

    const signedXDR = signAsClient(challenge.transactionXDR, Networks.TESTNET, clientKeypair);

    // Try with array of different domains
    const result = verifyChallenge(signedXDR, {
      serverAccountId: serverKeypair.publicKey(),
      networkPassphrase: Networks.TESTNET,
      homeDomains: 'domain-a.com',
      webAuthDomain: ['domain-x.com', 'domain-y.com', 'domain-z.com'],
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    // The error message should help debugging by indicating which domain(s) were tried
  });
});
