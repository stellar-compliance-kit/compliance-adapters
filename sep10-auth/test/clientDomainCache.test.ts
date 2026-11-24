/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import {
  createCachedClientSigningKeyResolver,
  createClientDomainTomlResolver,
} from '../src/clientDomainCache';

describe('client_domain signing key TTL cache (#993)', () => {
  it('serves repeat lookups from cache and counts hits/misses', async () => {
    const loader = jest.fn().mockResolvedValue('GABC');
    const increment = jest.fn();
    let clock = 1000;
    const cached = createCachedClientSigningKeyResolver(loader, {
      ttlMs: 100,
      now: () => clock,
      metrics: { increment },
    });

    expect(await cached('wallet.example')).toBe('GABC');
    expect(await cached('wallet.example')).toBe('GABC');
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cached.getStats()).toEqual({ hits: 1, misses: 1, size: 1 });
    expect(increment).toHaveBeenNthCalledWith(1, 'miss');
    expect(increment).toHaveBeenNthCalledWith(2, 'hit');

    clock += 101;
    await cached('wallet.example');
    expect(loader).toHaveBeenCalledTimes(2);
    expect(cached.getStats().misses).toBe(2);
  });

  it('evicts the least-recently-used domain past maxSize', async () => {
    const loader = jest.fn(async (domain: string) => `key-${domain}`);
    const cached = createCachedClientSigningKeyResolver(loader, { maxSize: 2 });

    await cached('a.example');
    await cached('b.example');
    await cached('a.example'); // refresh a, so b is now oldest
    await cached('c.example');

    expect(cached.getStats().size).toBe(2);
    expect(await cached('b.example')).toBe('key-b.example'); // miss after eviction
    expect(loader).toHaveBeenCalledTimes(4);
    cached.clear();
    expect(cached.getStats().size).toBe(0);
  });

  it('does not cache failed lookups', async () => {
    const loader = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('GOK');
    const cached = createCachedClientSigningKeyResolver(loader);
    await expect(cached('wallet.example')).rejects.toThrow('offline');
    expect(await cached('wallet.example')).toBe('GOK');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('validates options', () => {
    const loader = jest.fn();
    expect(() => createCachedClientSigningKeyResolver(loader, { ttlMs: -1 })).toThrow(/ttlMs/);
    expect(() => createCachedClientSigningKeyResolver(loader, { maxSize: 0 })).toThrow(/maxSize/);
  });

  it('provides a stellar.toml resolver helper', () => {
    expect(typeof createClientDomainTomlResolver()).toBe('function');
  });
});
