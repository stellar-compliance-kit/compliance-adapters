/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { StellarToml } from '@stellar/stellar-sdk';

/** Resolves the `SIGNING_KEY` published by a wallet's `client_domain`. */
export type ClientSigningKeyResolver = (clientDomain: string) => string | Promise<string>;

export interface ClientDomainCacheMetrics {
  /** Called with `hit` or `miss` on every lookup. */
  increment?: (outcome: 'hit' | 'miss') => void;
}

export interface ClientDomainCacheOptions {
  /** Entry lifetime in milliseconds. @default 300000 (5 minutes) */
  ttlMs?: number;
  /** Maximum number of cached domains (LRU eviction). @default 100 */
  maxSize?: number;
  /** Optional hit/miss metric sink. */
  metrics?: ClientDomainCacheMetrics;
  /** Injectable clock for tests. */
  now?: () => number;
}

export interface CachedClientSigningKeyResolver extends ClientSigningKeyResolver {
  /** Current cache counters and entry count. */
  getStats(): { hits: number; misses: number; size: number };
  /** Drop all cached entries (counters are preserved). */
  clear(): void;
}

interface CacheEntry {
  signingKey: string;
  expiresAt: number;
}

/**
 * Wraps a `client_domain` → `SIGNING_KEY` resolver in a bounded TTL cache.
 * Repeated SEP-10 challenges from the same wallet no longer refetch its
 * `stellar.toml` until the entry expires. Failed lookups are not cached.
 */
export function createCachedClientSigningKeyResolver(
  resolve: ClientSigningKeyResolver,
  options: ClientDomainCacheOptions = {},
): CachedClientSigningKeyResolver {
  const ttlMs = options.ttlMs ?? 300_000;
  const maxSize = options.maxSize ?? 100;
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    throw new Error('sep10-auth: clientDomainCache.ttlMs must be a non-negative number');
  }
  if (!Number.isInteger(maxSize) || maxSize < 1) {
    throw new Error('sep10-auth: clientDomainCache.maxSize must be a positive integer');
  }
  const now = options.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();
  let hits = 0;
  let misses = 0;

  const cached = (async (clientDomain: string): Promise<string> => {
    const entry = cache.get(clientDomain);
    if (entry && entry.expiresAt > now()) {
      // Refresh LRU position: Map iteration order is insertion order.
      cache.delete(clientDomain);
      cache.set(clientDomain, entry);
      hits++;
      options.metrics?.increment?.('hit');
      return entry.signingKey;
    }
    if (entry) cache.delete(clientDomain);

    misses++;
    options.metrics?.increment?.('miss');
    const signingKey = await resolve(clientDomain);
    if (typeof signingKey !== 'string' || signingKey.length === 0) {
      throw new Error(`sep10-auth: no SIGNING_KEY for client_domain "${clientDomain}"`);
    }
    cache.set(clientDomain, { signingKey, expiresAt: now() + ttlMs });
    if (cache.size > maxSize) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return signingKey;
  }) as CachedClientSigningKeyResolver;

  cached.getStats = () => ({ hits, misses, size: cache.size });
  cached.clear = () => cache.clear();
  return cached;
}

/**
 * Resolves a wallet's `SIGNING_KEY` from `https://<domain>/.well-known/stellar.toml`
 * using the Stellar SDK. Pair it with {@link createCachedClientSigningKeyResolver}
 * to avoid a network fetch on every challenge.
 */
export function createClientDomainTomlResolver(): ClientSigningKeyResolver {
  return async (clientDomain: string) => {
    const toml = await StellarToml.Resolver.resolve(clientDomain);
    const signingKey = (toml as { SIGNING_KEY?: string }).SIGNING_KEY;
    if (!signingKey) {
      throw new Error(`sep10-auth: no SIGNING_KEY in stellar.toml for "${clientDomain}"`);
    }
    return signingKey;
  };
}
