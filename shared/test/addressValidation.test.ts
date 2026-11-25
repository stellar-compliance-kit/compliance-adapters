/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * Tests for isValidStellarAddress utility.
 * Issue #125: Add a shared TypeScript utility type/package for cross-package
 * Stellar address validation.
 */

import { Keypair } from '@stellar/stellar-sdk';
import {
  isValidStellarAddress,
  normalizeStellarAddress,
  resolveFederationAddress,
  clearFederationCache,
  ok,
  err,
  isOk,
  isErr,
  type Result,
} from '../src/index';

describe('isValidStellarAddress', () => {
  it('returns true for a valid Ed25519 public key (G... prefix)', () => {
    const validAddress = Keypair.random().publicKey();
    expect(isValidStellarAddress(validAddress)).toBe(true);
  });

  it('returns false for an empty string', () => {
    expect(isValidStellarAddress('')).toBe(false);
  });

  it('returns false for a string with an invalid prefix', () => {
    expect(isValidStellarAddress('MAAZI4T7S6XNVW5RQFYNLJNHVBRFXRWUN5Q3NXPKV2HCEHZ3Y7WV2QHJR')).toBe(false);
  });

  it('returns false for a string that is too short', () => {
    expect(isValidStellarAddress('GABC')).toBe(false);
  });

  it('returns false for a string with lowercase letters in the payload', () => {
    expect(isValidStellarAddress('GaaZI4T7S6XNVW5RQFYNLJNHVBRFXRWUN5Q3NXPKV2HCEHZ3Y7WV2QHJR')).toBe(false);
  });

  it('returns false for a random non-Stellar string', () => {
    expect(isValidStellarAddress('not-a-stellar-address')).toBe(false);
  });
});

describe('normalizeStellarAddress', () => {
  const address = Keypair.random().publicKey();

  it('trims surrounding whitespace', () => {
    expect(normalizeStellarAddress(`  ${address}\t\n`)).toBe(address);
  });

  it('uppercases a lowercase address', () => {
    expect(normalizeStellarAddress(address.toLowerCase())).toBe(address);
  });

  it('maps mixed-case and padded input to one canonical, valid address', () => {
    const messy = ` ${address.slice(0, 20).toLowerCase()}${address.slice(20)} `;
    expect(normalizeStellarAddress(messy)).toBe(address);
    expect(isValidStellarAddress(normalizeStellarAddress(messy))).toBe(true);
  });

  it('does not validate: garbage stays invalid after normalizing', () => {
    expect(isValidStellarAddress(normalizeStellarAddress(' not-a-stellar-address '))).toBe(false);
  });
});

describe('resolveFederationAddress', () => {
  const accountId = Keypair.random().publicKey();
  const originalFetch = global.fetch;

  function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  beforeEach(() => {
    clearFederationCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('resolves name*domain.com to an account id', async () => {
    const fetchMock = mockFetchOnce({ stellar_address: accountId });

    const result = await resolveFederationAddress('alice*example.com');

    expect(result).toBe(accountId);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('https://example.com/.well-known/stellar.toml');
  });

  it('caches successful resolutions so the second call does not hit the network', async () => {
    const fetchMock = mockFetchOnce({ stellar_address: accountId });

    const first = await resolveFederationAddress('alice*example.com');
    const second = await resolveFederationAddress('alice*example.com');

    expect(first).toBe(accountId);
    expect(second).toBe(accountId);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('expires cached entries after the TTL', async () => {
    const fetchMock = mockFetchOnce({ stellar_address: accountId });

    await resolveFederationAddress('alice*example.com');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(Date.now() + 10 * 60 * 1000);

    await resolveFederationAddress('alice*example.com');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects addresses that are not in name*domain.com format', async () => {
    const fetchMock = mockFetchOnce({ stellar_address: accountId });

    await expect(resolveFederationAddress('not-a-federation-address')).rejects.toThrow();
    await expect(resolveFederationAddress('alice@example.com')).rejects.toThrow();
    await expect(resolveFederationAddress('*example.com')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when the federation server responds with an error status', async () => {
    mockFetchOnce({}, { ok: false, status: 500 });

    await expect(resolveFederationAddress('alice*example.com')).rejects.toThrow();
  });

  it('throws when the federation server response has no stellar_address', async () => {
    mockFetchOnce({});

    await expect(resolveFederationAddress('alice*example.com')).rejects.toThrow();
  });

  it('does not cache failed resolutions', async () => {
    const failing = mockFetchOnce({}, { ok: false, status: 500 });
    await expect(resolveFederationAddress('alice*example.com')).rejects.toThrow();
    expect(failing).toHaveBeenCalledTimes(1);

    const succeeding = mockFetchOnce({ stellar_address: accountId });
    const result = await resolveFederationAddress('alice*example.com');
    expect(result).toBe(accountId);
    expect(succeeding).toHaveBeenCalledTimes(1);
  });
});

describe('Result helpers', () => {
  it('ok() builds a success result', () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
    if (isOk(result)) {
      expect(result.value).toBe(42);
    }
  });

  it('err() builds a failure result', () => {
    const result = err(new Error('boom'));
    expect(result.ok).toBe(false);
    expect(isErr(result)).toBe(true);
    expect(isOk(result)).toBe(false);
    if (isErr(result)) {
      expect(result.error.message).toBe('boom');
    }
  });

  it('narrows the union type via isOk/isErr', () => {
    const result: Result<number, string> = Math.random() > 2 ? ok(1) : err('nope');

    if (isOk(result)) {
      const value: number = result.value;
      expect(value).toBe(1);
    } else {
      const error: string = result.error;
      expect(error).toBe('nope');
    }
  });

  it('preserves falsy success values', () => {
    const result = ok(0);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe(0);
    }
  });
});
