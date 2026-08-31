/**
 * SDK compatibility tests.
 *
 * These tests intentionally exercise the public package boundaries together
 * without requiring Docker or a live network. CI runs this file once for each
 * supported @stellar/stellar-sdk minor version.
 */

import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { generateChallenge, verifyChallenge } from 'sep10-auth';
import { syncSanctionsToDenylist, MockSanctionsProvider } from 'sanctions-oracle';
import { HorizonListener } from 'horizon-listener';

describe('public adapter compatibility across Stellar SDK minors', () => {
  it('generates and verifies a SEP-10 challenge', () => {
    const server = Keypair.random();
    const client = Keypair.random();
    const challenge = generateChallenge(client.publicKey(), server, {
      homeDomain: 'example.com',
      webAuthDomain: 'auth.example.com',
      networkPassphrase: Networks.TESTNET,
    });

    const transaction = TransactionBuilder.fromXDR(challenge.transactionXDR, Networks.TESTNET);
    transaction.sign(client);

    expect(
      verifyChallenge(transaction.toXDR(), {
        serverAccountId: server.publicKey(),
        homeDomains: 'example.com',
        webAuthDomain: 'auth.example.com',
        networkPassphrase: Networks.TESTNET,
      }),
    ).toMatchObject({ valid: true, address: client.publicKey() });
  });

  it('runs the sanctions sync and listener pipeline through public APIs', async () => {
    const address = Keypair.random().publicKey();
    const received: string[] = [];
    const listener = new HorizonListener({
      eventSource: {
        getEvents: async (cursor?: string) => ({
          events: cursor
            ? []
            : [
                {
                  id: 'compatibility-event',
                  contractId: 'CXXX',
                  ledger: 1,
                  topic: ['added'],
                  value: address,
                },
              ],
          nextCursor: 'compatibility-event',
        }),
      },
      onEvent: (event) => {
        received.push(event.id);
        listener.stop();
      },
      pollIntervalMs: 0,
    });

    const result = await syncSanctionsToDenylist({
      provider: new MockSanctionsProvider({ flaggedAddresses: [address] }),
      addresses: [address],
      writer: { addToDenylist: async () => ({ hash: 'compatibility-tx' }) },
    });

    await listener.start();

    expect(result).toMatchObject({
      checked: 1,
      flagged: [address],
      written: [address],
      failed: [],
    });
    expect(received).toEqual(['compatibility-event']);
  });
});
