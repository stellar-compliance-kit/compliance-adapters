/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { Keypair } from '@stellar/stellar-sdk';
import {
  parseArgs,
  syncSanctionsToDenylist,
  DenylistWriter,
  RemovalReviewEntry,
} from '../src/sync';
import type { SanctionsProvider } from '../src/SanctionsProvider';

const OLD = Keypair.random().publicKey();
const YOUNG = Keypair.random().publicKey();
const UNKNOWN = Keypair.random().publicKey();

const provider: SanctionsProvider = {
  checkAddress: jest.fn(async () => ({ flagged: false, source: 'ofac-sdn' })),
};

function makeWriter(): DenylistWriter & { removeFromDenylist: jest.Mock } {
  return {
    addToDenylist: jest.fn(async () => ({ hash: 'add' })),
    removeFromDenylist: jest.fn(async () => ({ hash: 'rm' })),
  };
}

describe('delisting age safeguards', () => {
  it('removes only entries older than the minimum age and queues the rest for review', async () => {
    const writer = makeWriter();
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: [],
      writer,
      currentDenylist: [OLD, YOUNG, UNKNOWN],
      denylistAddedAt: { [OLD]: daysAgo(60), [YOUNG]: daysAgo(2) },
      minRemovalAgeDays: 30,
      reconcile: true,
    });

    expect(result.removed).toEqual([OLD]);
    expect(writer.removeFromDenylist).toHaveBeenCalledTimes(1);
    expect(result.removalReviewQueue).toEqual(
      expect.arrayContaining<RemovalReviewEntry>([
        { address: YOUNG, source: 'ofac-sdn', reason: 'too-new', minRemovalAgeDays: 30 },
        { address: UNKNOWN, source: 'ofac-sdn', reason: 'unknown-age', minRemovalAgeDays: 30 },
      ]),
    );
    expect(result.removalReviewQueue).toHaveLength(2);
  });

  it('does not remove anything without the reconcile flag, regardless of age', async () => {
    const writer = makeWriter();
    const result = await syncSanctionsToDenylist({
      provider,
      addresses: [OLD],
      writer,
      currentDenylist: [OLD],
      denylistAddedAt: { [OLD]: new Date(Date.now() - 365 * 86_400_000).toISOString() },
      minRemovalAgeDays: 1,
    });

    expect(result.removed).toBeUndefined();
    expect(result.removalReviewQueue).toBeUndefined();
    expect(writer.removeFromDenylist).not.toHaveBeenCalled();
  });

  it('handles invalid future addedAt values as a review case', async () => {
    const writer = makeWriter();
    const result = await syncSanctionsToDenylist({
      provider,
      addresses: [],
      writer,
      currentDenylist: [OLD],
      denylistAddedAt: { [OLD]: new Date(Date.now() + 86_400_000).toISOString() },
      minRemovalAgeDays: 1,
      reconcile: true,
    });

    expect(result.removed).toEqual([]);
    expect(result.removalReviewQueue?.[0].reason).toBe('invalid-age');
  });

  it('parses the CLI flag', () => {
    expect(parseArgs(['--min-removal-age-days', '45']).minRemovalAgeDays).toBe(45);
    expect(() => parseArgs(['--min-removal-age-days', 'abc'])).toThrow(/non-negative/);
  });
});
