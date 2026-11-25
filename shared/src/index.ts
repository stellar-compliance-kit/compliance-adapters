/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { StrKey } from '@stellar/stellar-sdk';

export { combineExpositions } from './metrics';
export {
  createSemaphore,
  SemaphoreTimeoutError,
} from './semaphore';
export type { Semaphore, SemaphoreAcquireOptions } from './semaphore';

/**
 * Validate a Stellar address (Ed25519 public key in StrKey `G...` format).
 * Thin wrapper around {@link https://developers.stellar.org/docs/start/list-of-operations-and-requests/ StrKey.isValidEd25519PublicKey}
 * from `@stellar/stellar-sdk`, centralised so all compliance-adapters packages
 * share the same validation logic without duplicating the `@stellar/stellar-sdk`
 * dependency.
 */
export function isValidStellarAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address);
}

/**
 * Canonical form of a Stellar address: surrounding whitespace removed and
 * uppercased. Addresses arriving from CSV files, JSON input or REST providers
 * may be padded or lowercase; normalize them at every ingestion boundary so the
 * same account is never checked, cached or written twice under two spellings.
 * Does not validate — pair with {@link isValidStellarAddress}.
 */
export function normalizeStellarAddress(address: string): string {
  return address.trim().toUpperCase();
}

/**
 * Redact a Stellar address for logs: keeps the first 4 and last 4
 * characters (`GABC…WXYZ`) so log lines stay correlatable without
 * exposing the full account. Applies to `G` (ed25519), `M` (muxed)
 * and `C` (contract) addresses. Returns `[invalid-address]` for
 * non-string or too-short input.
 */
export function redactAddress(addr: unknown): string {
  if (typeof addr !== 'string' || addr.length < 8) {
    return '[invalid-address]';
  }
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/**
 * Discriminated union representing the outcome of an operation that can fail
 * without throwing. `ok` narrows to `{ ok: true; value: T }` and `err` to
 * `{ ok: false; error: E }`. Prefer this over ad-hoc `{ success, data }`
 * shapes so error handling stays consistent across packages.
 */
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Construct a successful {@link Result}. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Construct a failed {@link Result}. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Type guard narrowing a {@link Result} to its success variant. */
export function isOk<T, E>(result: Result<T, E>): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}

/** Type guard narrowing a {@link Result} to its failure variant. */
export function isErr<T, E>(result: Result<T, E>): result is { readonly ok: false; readonly error: E } {
  return !result.ok;
}

/** Error codes returned by {@link resolveFederationAddress}. */
export type FederationResolveErrorCode =
  | 'INVALID_ADDRESS'
  | 'TOML_FETCH_FAILED'
  | 'TOML_INVALID'
  | 'FEDERATION_SERVER_NOT_FOUND'
  | 'FEDERATION_LOOKUP_FAILED'
  | 'ACCOUNT_NOT_FOUND'
  | 'INVALID_ACCOUNT_ID';

/** Typed failure returned by {@link resolveFederationAddress}. */
export interface FederationResolveError {
  readonly code: FederationResolveErrorCode;
  readonly message: string;
}

/** Options for {@link resolveFederationAddress}. */
export interface ResolveFederationAddressOptions {
  /** Injectable fetch implementation (defaults to global `fetch`). */
  fetch?: typeof fetch;
  /** Cache TTL in milliseconds for successful resolutions. Default: 5 minutes. */
  ttlMs?: number;
  /** Maximum number of cached resolutions. Default: 1000. */
  maxCacheSize?: number;
  /** Per-request timeout in milliseconds. Default: 10 seconds. */
  timeoutMs?: number;
}

interface CacheEntry {
  readonly accountId: string;
  readonly expiresAt: number;
}

const FEDERATION_ADDRESS_RE = /^([^*\s]+)\*([A-Za-z0-9.-]+\.[A-Za-z]{2,})$/;

const federationCache = new Map<string, CacheEntry>();

function cacheGet(key: string, now: number): string | undefined {
  const entry = federationCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    federationCache.delete(key);
    return undefined;
  }
  // Refresh LRU ordering.
  federationCache.delete(key);
  federationCache.set(key, entry);
  return entry.accountId;
}

function cacheSet(key: string, accountId: string, expiresAt: number, maxSize: number): void {
  federationCache.delete(key);
  federationCache.set(key, { accountId, expiresAt });
  while (federationCache.size > maxSize) {
    const oldest = federationCache.keys().next().value;
    if (oldest === undefined) break;
    federationCache.delete(oldest);
  }
}

/** Clear the federation resolution cache (primarily for tests). */
export function clearFederationCache(): void {
  federationCache.clear();
}

function extractFederationServerUrl(toml: string): string | undefined {
  // Minimal TOML scan: find FEDERATION_SERVER = "..." (case-insensitive key).
  const match = /^\s*FEDERATION_SERVER\s*=\s*["']([^"']+)["']/m.exec(toml);
  return match?.[1];
}

/**
 * Resolve a federation address (`name*domain.com`) to a Stellar account ID.
 *
 * Discovers the federation server via the domain's
 * `/.well-known/stellar.toml`, queries its `/federation` endpoint with
 * `type=name&q=<address>`, and validates the returned account ID. Successful
 * resolutions are cached in an in-memory TTL cache bounded by `maxCacheSize`.
 * Never throws: all failures are returned as a typed {@link Result}.
 */
export async function resolveFederationAddress(
  address: string,
  options: ResolveFederationAddressOptions = {},
): Promise<Result<string, FederationResolveError>> {
  const trimmed = typeof address === 'string' ? address.trim() : '';
  const match = FEDERATION_ADDRESS_RE.exec(trimmed);
  if (!match) {
    return err({
      code: 'INVALID_ADDRESS',
      message: `Invalid federation address: ${String(address)}`,
    });
  }
  const [, name, domain] = match;
  const normalized = `${name}*${domain.toLowerCase()}`;

  const now = Date.now();
  const ttlMs = options.ttlMs ?? 5 * 60 * 1000;
  const maxCacheSize = options.maxCacheSize ?? 1000;
  const cached = cacheGet(normalized, now);
  if (cached !== undefined) {
    return ok(cached);
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return err({
      code: 'TOML_FETCH_FAILED',
      message: 'No fetch implementation available',
    });
  }

  const timeoutMs = options.timeoutMs ?? 10_000;
  const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
    ? AbortSignal.timeout(timeoutMs)
    : undefined;

  let toml: string;
  try {
    const res = await fetchImpl(`https://${domain}/.well-known/stellar.toml`, { signal });
    if (!res.ok) {
      return err({
        code: 'TOML_FETCH_FAILED',
        message: `Failed to fetch stellar.toml for ${domain}: HTTP ${res.status}`,
      });
    }
    toml = await res.text();
  } catch (e) {
    return err({
      code: 'TOML_FETCH_FAILED',
      message: `Failed to fetch stellar.toml for ${domain}: ${(e as Error).message}`,
    });
  }

  const serverUrl = extractFederationServerUrl(toml);
  if (!serverUrl) {
    return err({
      code: 'FEDERATION_SERVER_NOT_FOUND',
      message: `No FEDERATION_SERVER in stellar.toml for ${domain}`,
    });
  }

  let serverBase: URL;
  try {
    serverBase = new URL(serverUrl);
  } catch {
    return err({
      code: 'TOML_INVALID',
      message: `Invalid FEDERATION_SERVER URL for ${domain}: ${serverUrl}`,
    });
  }
  if (serverBase.protocol !== 'https:') {
    return err({
      code: 'TOML_INVALID',
      message: `FEDERATION_SERVER must use https for ${domain}`,
    });
  }

  const lookupUrl = new URL('/federation', serverBase);
  lookupUrl.searchParams.set('type', 'name');
  lookupUrl.searchParams.set('q', normalized);

  let accountId: unknown;
  try {
    const res = await fetchImpl(lookupUrl.toString(), { signal });
    if (!res.ok) {
      return err({
        code: 'FEDERATION_LOOKUP_FAILED',
        message: `Federation lookup failed for ${normalized}: HTTP ${res.status}`,
      });
    }
    const body = (await res.json()) as { account_id?: unknown };
    accountId = body?.account_id;
  } catch (e) {
    return err({
      code: 'FEDERATION_LOOKUP_FAILED',
      message: `Federation lookup failed for ${normalized}: ${(e as Error).message}`,
    });
  }

  if (typeof accountId !== 'string' || accountId.length === 0) {
    return err({
      code: 'ACCOUNT_NOT_FOUND',
      message: `Federation server returned no account_id for ${normalized}`,
    });
  }

  const normalizedAccount = normalizeStellarAddress(accountId);
  if (!isValidStellarAddress(normalizedAccount)) {
    return err({
      code: 'INVALID_ACCOUNT_ID',
      message: `Federation server returned an invalid account_id for ${normalized}`,
    });
  }

  cacheSet(normalized, normalizedAccount, now + ttlMs, maxCacheSize);
  return ok(normalizedAccount);
}
