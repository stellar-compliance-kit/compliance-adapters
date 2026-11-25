/// <reference types="jest" />

/**
 * Issue #344: syncSanctionsToDenylist can checkpoint progress so a large sync
 * interrupted by a crash resumes instead of restarting from address zero.
 */

import { Keypair } from '@stellar/stellar-sdk';
import { syncSanctionsToDenylist, DenylistWriter } from '../src/sync';
import { InMemoryCheckpointStore, SyncCheckpointStore } from '../src/checkpoint';
import { InMemoryProviderCache, ProviderCache } from '../src/providerCache';
import { MockSanctionsProvider, MOCK_FLAGGED_ADDRESSES } from '../src/mockProvider';

const FLAGGED_ADDRESSES = Object.keys(MOCK_FLAGGED_ADDRESSES);
const FLAGGED_ADDRESS = FLAGGED_ADDRESSES[0];
const CLEAN_ADDRESS = Keypair.random().publicKey();

function makeFakeWriter(): DenylistWriter & { addToDenylist: jest.Mock } {
  return { addToDenylist: jest.fn().mockResolvedValue({ hash: 'fakehash' }) };
}

describe('InMemoryCheckpointStore', () => {
  it('records and reports completed addresses', () => {
    const store = new InMemoryCheckpointStore();
    expect(store.isComplete(FLAGGED_ADDRESS)).toBe(false);

    store.markComplete(FLAGGED_ADDRESS);

    expect(store.isComplete(FLAGGED_ADDRESS)).toBe(true);
    expect(store.snapshot()).toEqual([FLAGGED_ADDRESS]);
  });

  it('seeds from an initial iterable', () => {
    const store = new InMemoryCheckpointStore([FLAGGED_ADDRESS, CLEAN_ADDRESS]);
    expect(store.isComplete(FLAGGED_ADDRESS)).toBe(true);
    expect(store.isComplete(CLEAN_ADDRESS)).toBe(true);
  });
});

describe('syncSanctionsToDenylist — checkpointing (issue #598)', () => {
  it('marks a clean address complete after its provider check', async () => {
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();
    const checkpoint = new InMemoryCheckpointStore();

    await syncSanctionsToDenylist({
      provider,
      addresses: [CLEAN_ADDRESS],
      writer,
      dryRun: true,
      checkpoint,
    });

    expect(checkpoint.isComplete(CLEAN_ADDRESS)).toBe(true);
  });

  it('marks a flagged address complete only after the denylist write succeeds', async () => {
    const provider = new MockSanctionsProvider();
    const checkpoint = new InMemoryCheckpointStore();
    const writer: DenylistWriter = {
      addToDenylist: jest.fn().mockRejectedValue(new Error('rpc down')),
    };

    await expect(
      syncSanctionsToDenylist({
        provider,
        addresses: [FLAGGED_ADDRESS],
        writer,
        dryRun: false,
        checkpoint,
      }),
    ).rejects.toThrow('rpc down');

    // Write failed → not checkpointed → a resume will retry it.
    expect(checkpoint.isComplete(FLAGGED_ADDRESS)).toBe(false);
  });

  it('does not checkpoint a flagged address in dry-run mode (no write happened)', async () => {
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();
    const checkpoint = new InMemoryCheckpointStore();

    await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESS],
      writer,
      dryRun: true,
      checkpoint,
    });

    expect(checkpoint.isComplete(FLAGGED_ADDRESS)).toBe(false);
  });

  it('with resume:true, skips addresses the checkpoint already recorded', async () => {
    const provider = new MockSanctionsProvider();
    const checkSpy = jest.spyOn(provider, 'checkAddress');
    const writer = makeFakeWriter();
    const checkpoint = new InMemoryCheckpointStore([FLAGGED_ADDRESSES[0], FLAGGED_ADDRESSES[1]]);

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESSES[0], FLAGGED_ADDRESSES[1], FLAGGED_ADDRESSES[2], CLEAN_ADDRESS],
      writer,
      dryRun: false,
      checkpoint,
      resume: true,
    });

    expect(result.skipped).toEqual([FLAGGED_ADDRESSES[0], FLAGGED_ADDRESSES[1]]);
    expect(result.checked).toBe(2);
    expect(result.flagged).toEqual([FLAGGED_ADDRESSES[2]]);
    expect(result.written).toEqual([FLAGGED_ADDRESSES[2]]);

    // The two already-complete addresses are never re-checked or re-written.
    expect(checkSpy).toHaveBeenCalledTimes(2);
    expect(writer.addToDenylist).toHaveBeenCalledTimes(1);
    expect(writer.addToDenylist).toHaveBeenCalledWith(FLAGGED_ADDRESSES[2]);
  });

  it('resume is a no-op without a checkpoint store', async () => {
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESS, CLEAN_ADDRESS],
      writer,
      dryRun: false,
      resume: true,
    });

    expect(result.skipped).toEqual([]);
    expect(result.written).toEqual([FLAGGED_ADDRESS]);
  });

  it('a crash-then-resume run completes every flagged write exactly once', async () => {
    const checkpoint = new InMemoryCheckpointStore();
    const addresses = [...FLAGGED_ADDRESSES, CLEAN_ADDRESS];

    // First run: the writer dies on the 3rd flagged address.
    const failingWriter: DenylistWriter = {
      addToDenylist: jest
        .fn()
        .mockResolvedValueOnce({ hash: 'h1' })
        .mockResolvedValueOnce({ hash: 'h2' })
        .mockRejectedValue(new Error('process crashed mid-write')),
    };

    await expect(
      syncSanctionsToDenylist({
        provider: new MockSanctionsProvider(),
        addresses,
        writer: failingWriter,
        dryRun: false,
        checkpoint,
        resume: true,
      }),
    ).rejects.toThrow('process crashed mid-write');

    expect(checkpoint.snapshot().sort()).toEqual(
      [FLAGGED_ADDRESSES[0], FLAGGED_ADDRESSES[1], CLEAN_ADDRESS].sort(),
    );

    // Second run: fresh writer, same inputs, resume from the checkpoint.
    const goodWriter = makeFakeWriter();
    const result = await syncSanctionsToDenylist({
      provider: new MockSanctionsProvider(),
      addresses,
      writer: goodWriter,
      dryRun: false,
      checkpoint,
      resume: true,
    });

    // Only the addresses not yet completed are processed on the resume.
    expect(result.skipped.sort()).toEqual(
      [FLAGGED_ADDRESSES[0], FLAGGED_ADDRESSES[1], CLEAN_ADDRESS].sort(),
    );
    expect(result.written).toEqual([FLAGGED_ADDRESSES[2], FLAGGED_ADDRESSES[3]]);
    expect(goodWriter.addToDenylist).toHaveBeenCalledTimes(2);
    expect(checkpoint.snapshot().sort()).toEqual([...addresses].sort());
  });

  it('supports an async checkpoint store', async () => {
    const backing = new Set<string>();
    const asyncStore: SyncCheckpointStore = {
      isComplete: async (a) => backing.has(a),
      markComplete: async (a) => {
        backing.add(a);
      },
    };
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();

    await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESS, CLEAN_ADDRESS],
      writer,
      dryRun: false,
      checkpoint: asyncStore,
    });

    expect(backing.has(FLAGGED_ADDRESS)).toBe(true);
    expect(backing.has(CLEAN_ADDRESS)).toBe(true);
  });
});

describe('InMemoryProviderCache (issue #1062)', () => {
  it('stores and returns a cached provider result within the TTL', async () => {
    const cache = new InMemoryProviderCache({ ttlMs: 60_000 });
    const body = { addresses: [FLAGGED_ADDRESS] };

    await cache.set('mock', { body, etag: '"v1"', lastModified: 'Wed, 21 Oct 2015 07:28:00 GMT' });

    const entry = await cache.get('mock');
    expect(entry).not.toBeNull();
    expect(entry!.body).toEqual(body);
    expect(entry!.etag).toBe('"v1"');
    expect(entry!.lastModified).toBe('Wed, 21 Oct 2015 07:28:00 GMT');
  });

  it('returns null for an unknown provider', async () => {
    const cache = new InMemoryProviderCache({ ttlMs: 60_000 });
    expect(await cache.get('never-seen')).toBeNull();
  });

  it('expires entries once the TTL has elapsed', async () => {
    let now = 1_000;
    const cache = new InMemoryProviderCache({ ttlMs: 500, now: () => now });
    await cache.set('mock', { body: { addresses: [FLAGGED_ADDRESS] } });

    now += 499;
    expect(await cache.get('mock')).not.toBeNull();

    now += 2;
    expect(await cache.get('mock')).toBeNull();
  });

  it('supports an async cache store', async () => {
    const backing = new Map<string, unknown>();
    const asyncCache: ProviderCache = {
      get: async (key) => (backing.get(key) as never) ?? null,
      set: async (key, entry) => {
        backing.set(key, entry);
      },
    };

    await asyncCache.set('mock', { body: { addresses: [] } });
    expect(await asyncCache.get('mock')).not.toBeNull();
  });
});

describe('syncSanctionsToDenylist — provider cache (issue #1062)', () => {
  it('reuses cached provider data on a second run instead of refetching', async () => {
    const cache = new InMemoryProviderCache({ ttlMs: 60_000 });
    const firstProvider = new MockSanctionsProvider();
    const firstFetchSpy = jest.spyOn(firstProvider, 'fetchAddresses');

    await syncSanctionsToDenylist({
      provider: firstProvider,
      addresses: [FLAGGED_ADDRESS, CLEAN_ADDRESS],
      writer: makeFakeWriter(),
      dryRun: true,
      cache,
    });
    expect(firstFetchSpy).toHaveBeenCalledTimes(1);

    const secondProvider = new MockSanctionsProvider();
    const secondFetchSpy = jest.spyOn(secondProvider, 'fetchAddresses');

    const result = await syncSanctionsToDenylist({
      provider: secondProvider,
      addresses: [FLAGGED_ADDRESS, CLEAN_ADDRESS],
      writer: makeFakeWriter(),
      dryRun: true,
      cache,
    });

    // Cache hit: the provider is not asked to fetch again.
    expect(secondFetchSpy).not.toHaveBeenCalled();
    expect(result.flagged).toEqual([FLAGGED_ADDRESS]);
  });

  it('reuses the cached body when the provider answers 304 Not Modified', async () => {
    const cache = new InMemoryProviderCache({ ttlMs: 60_000 });
    const body = [FLAGGED_ADDRESS];

    await cache.set('mock', { body, etag: '"v1"' });

    const provider = new MockSanctionsProvider();
    const fetchSpy = jest
      .spyOn(provider, 'fetchAddresses')
      .mockResolvedValue({ notModified: true, etag: '"v1"' } as never);

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESS, CLEAN_ADDRESS],
      writer: makeFakeWriter(),
      dryRun: true,
      cache,
    });

    expect(fetchSpy).toHaveBeenCalledWith(expect.objectContaining({ etag: '"v1"' }));
    expect(result.flagged).toEqual([FLAGGED_ADDRESS]);
    // The cached entry survives a 304 and its TTL is refreshed.
    expect(await cache.get('mock')).not.toBeNull();
  });

  it('refetches in full once the cached entry has expired', async () => {
    let now = 1_000;
    const cache = new InMemoryProviderCache({ ttlMs: 500, now: () => now });

    await syncSanctionsToDenylist({
      provider: new MockSanctionsProvider(),
      addresses: [FLAGGED_ADDRESS],
      writer: makeFakeWriter(),
      dryRun: true,
      cache,
    });

    now += 1_000;

    const provider = new MockSanctionsProvider();
    const fetchSpy = jest.spyOn(provider, 'fetchAddresses');

    await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESS],
      writer: makeFakeWriter(),
      dryRun: true,
      cache,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('--no-cache bypasses both cache reads and writes', async () => {
    const cache = new InMemoryProviderCache({ ttlMs: 60_000 });
    const getSpy = jest.spyOn(cache, 'get');
    const setSpy = jest.spyOn(cache, 'set');

    const provider = new MockSanctionsProvider();
    const fetchSpy = jest.spyOn(provider, 'fetchAddresses');

    await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESS],
      writer: makeFakeWriter(),
      dryRun: true,
      cache,
      noCache: true,
    });

    expect(getSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
