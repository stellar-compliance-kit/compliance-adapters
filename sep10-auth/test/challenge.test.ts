import { Keypair, Networks, Transaction } from '@stellar/stellar-sdk';
import { generateChallenge, InvalidClientAddressError } from '../src/challenge';

describe('generateChallenge', () => {
  const homeDomain = 'localhost:3000';

  it('builds a challenge transaction for the given client address', () => {
    const serverKeypair = Keypair.random();
    const clientKeypair = Keypair.random();

    const before = Date.now();
    const challenge = generateChallenge(clientKeypair.publicKey(), serverKeypair, {
      homeDomain,
      webAuthDomain: homeDomain,
      networkPassphrase: Networks.TESTNET,
      timeoutSeconds: 300,
    });
    const after = Date.now();

    expect(typeof challenge.transactionXDR).toBe('string');
    expect(challenge.networkPassphrase).toBe(Networks.TESTNET);

    const tx = new Transaction(challenge.transactionXDR, Networks.TESTNET);
    expect(tx).toBeDefined();

    expect(challenge.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 300 * 1000);
    expect(challenge.expiresAt.getTime()).toBeLessThanOrEqual(after + 300 * 1000 + 50);
  });

  it('defaults homeDomain, webAuthDomain and networkPassphrase when omitted', () => {
    const serverKeypair = Keypair.random();
    const clientKeypair = Keypair.random();

    const challenge = generateChallenge(clientKeypair.publicKey(), serverKeypair);

    expect(challenge.networkPassphrase).toBe(Networks.TESTNET);
    expect(challenge.transactionXDR.length).toBeGreaterThan(0);
  });

  it('throws InvalidClientAddressError when clientAddress is not a valid Stellar Ed25519 public key', () => {
    const serverKeypair = Keypair.random();
    const invalidAddress = 'invalid-address';

    expect(() => generateChallenge(invalidAddress, serverKeypair)).toThrow(
      InvalidClientAddressError,
    );
  });
});
