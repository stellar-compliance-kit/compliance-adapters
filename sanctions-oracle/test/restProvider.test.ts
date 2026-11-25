/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { RestSanctionsProvider } from '../src/restProvider';
import type { ProviderCache, ProviderCacheEntry } from '../src/providerCache';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FLAGGED_ADDRESS = 'GD7PQQDZ75ZIY3O3CZKO4P6NBRBDBYEM6PKROQUVKMXI6J2SAB4FWYAN';
const CLEAN_ADDRESS = 'GDNOTPRESENTINANYMOCKWATCHLISTAAAAAAAAAAAAAAAAAAAAAAAAAA';
const BASE_URL = 'https://api.example-watchlist.com';
const API_KEY = 'test-api-key-abc123';

/** Creates a minimal mock Response that satisfies the Fetch Response interface. */
function makeResponse(body: object, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Builds a provider with an injected fetch mock. */
function makeProvider(
  fetchImpl: jest.MockedFunction<typeof fetch>,
  overrides: { timeoutMs?: number; cache?: ProviderCache } = {},
) {
  return new RestSanctionsProvider({
    apiBaseUrl: BASE_URL,
    apiKey: API_KEY,
    fetchImpl,
    ...overrides,
  });
}

/** Creates an in-memory ProviderCache for tests. */
function makeCache(initial: Record<string, ProviderCacheEntry> = {}): ProviderCache & {
  store: Map<string, ProviderCacheEntry>;
} {
  const store = new Map<string, ProviderCacheEntry>(Object.entries(initial));
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key)),
    set: jest.fn(async (key: string, entry: ProviderCacheEntry) => {
      store.set(key, entry);
    }),
  };
}

/** Creates a mock Response that also exposes response headers. */
function makeResponseWithHeaders(
  body: object,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const lower = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => lower.get(name.toLowerCase()) ?? null,
    },
    json: async () => body,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RestSanctionsProvider', () => {
  describe('checkAddress — success paths', () => {
    it('returns flagged:true and joins the lists array when the API flags an address', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(
        makeResponse({ is_flagged: true, lists: ['OFAC-SDN', 'EU-SANCTIONS'] }),
      );
      const provider = makeProvider(fetchImpl);

      const result = await provider.checkAddress(FLAGGED_ADDRESS);

      expect(result.flagged).toBe(true);
      expect(result.source).toBe('OFAC-SDN,EU-SANCTIONS');
    });

    it('returns flagged:false when the API does not flag an address', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(
        makeResponse({ is_flagged: false, lists: [] }),
      );
      const provider = makeProvider(fetchImpl);

      const result = await provider.checkAddress(CLEAN_ADDRESS);

      expect(result.flagged).toBe(false);
    });

    it('falls back to "external-watchlist-api" as source when the lists array is empty', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(
        makeResponse({ is_flagged: true, lists: [] }),
      );
      const provider = makeProvider(fetchImpl);

      const result = await provider.checkAddress(FLAGGED_ADDRESS);

      expect(result.source).toBe('external-watchlist-api');
    });

    it('URL-encodes the address in the query string', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(makeResponse({ is_flagged: false, lists: [] }));
      const provider = makeProvider(fetchImpl);
      const addressWithSpecialChars = 'G+ADDR=WITH&SPECIAL';

      await provider.checkAddress(addressWithSpecialChars);

      const [calledUrl] = fetchImpl.mock.calls[0];
      expect(calledUrl).toContain(encodeURIComponent(addressWithSpecialChars));
    });

    it('sends the API key as a Bearer token in the Authorization header', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(
        makeResponse({ is_flagged: false, lists: [] }),
      );
      const provider = makeProvider(fetchImpl);

      await provider.checkAddress(CLEAN_ADDRESS);

      const [, init] = fetchImpl.mock.calls[0];
      expect((init?.headers as Record<string, string>)?.['Authorization']).toBe(
        `Bearer ${API_KEY}`,
      );
    });

    it('strips a trailing slash from apiBaseUrl before constructing the URL', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(
        makeResponse({ is_flagged: false, lists: [] }),
      );
      const provider = new RestSanctionsProvider({
        apiBaseUrl: `${BASE_URL}/`, // trailing slash
        apiKey: API_KEY,
        fetchImpl,
      });

      await provider.checkAddress(CLEAN_ADDRESS);

      const [calledUrl] = fetchImpl.mock.calls[0];
      expect(calledUrl).toMatch(/^https:\/\/api\.example-watchlist\.com\/check\?/);
      // must not contain double-slash before "check"
      expect(calledUrl).not.toContain('//check');
    });
  });

  describe('checkAddress — error paths', () => {
    it('throws when the API responds with a non-2xx status', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(makeResponse({}, 403));
      const provider = makeProvider(fetchImpl);

      await expect(provider.checkAddress(FLAGGED_ADDRESS)).rejects.toThrow(/HTTP 403/);
    });

    it('throws with a timeout message when fetch is aborted by the timeout controller', async () => {
      const abortError = Object.assign(new Error('The operation was aborted'), {
        name: 'AbortError',
      });
      const fetchImpl = jest.fn().mockRejectedValue(abortError);
      const provider = makeProvider(fetchImpl, { timeoutMs: 1 });

      await expect(provider.checkAddress(FLAGGED_ADDRESS)).rejects.toThrow(/timed out/i);
    });

    it('wraps a generic network error with address context', async () => {
      const networkError = new Error('ECONNREFUSED');
      const fetchImpl = jest.fn().mockRejectedValue(networkError);
      const provider = makeProvider(fetchImpl);

      await expect(provider.checkAddress(FLAGGED_ADDRESS)).rejects.toThrow(
        new RegExp(`request failed for address ${FLAGGED_ADDRESS}`),
      );
    });

    it('passes an AbortSignal to fetch so the timeout can actually fire', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(
        makeResponse({ is_flagged: false, lists: [] }),
      );
      const provider = makeProvider(fetchImpl);

      await provider.checkAddress(CLEAN_ADDRESS);

      const [, init] = fetchImpl.mock.calls[0];
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('checkAddress — conditional requests and caching', () => {
    it('sends If-None-Match when a cached entry with an ETag exists within TTL', async () => {
      const cache = makeCache({
        [FLAGGED_ADDRESS]: {
          etag: '"abc123"',
          lastModified: undefined,
          body: { is_flagged: true, lists: ['OFAC-SDN'] },
          fetchedAt: Date.now(),
        },
      });
      const fetchImpl = jest.fn().mockResolvedValue(
        makeResponseWithHeaders({ is_flagged: true, lists: ['OFAC-SDN'] }),
      );
      const provider = makeProvider(fetchImpl, { cache });

      await provider.checkAddress(FLAGGED_ADDRESS);

      const [, init] = fetchImpl.mock.calls[0];
      const headers = init?.headers as Record<string, string>;
      expect(headers['If-None-Match']).toBe('"abc123"');
      expect(headers['If-Modified-Since']).toBeUndefined();
    });

    it('sends If-Modified-Since when a cached entry with Last-Modified exists within TTL', async () => {
      const lastModified = 'Wed, 21 Oct 2026 07:28:00 GMT';
      const cache = makeCache({
        [FLAGGED_ADDRESS]: {
          etag: undefined,
          lastModified,
          body: { is_flagged: true, lists: ['OFAC-SDN'] },
          fetchedAt: Date.now(),
        },
      });
      const fetchImpl = jest.fn().mockResolvedValue(
        makeResponseWithHeaders({ is_flagged: true, lists: ['OFAC-SDN'] }),
      );
      const provider = makeProvider(fetchImpl, { cache });

      await provider.checkAddress(FLAGGED_ADDRESS);

      const [, init] = fetchImpl.mock.calls[0];
      const headers = init?.headers as Record<string, string>;
      expect(headers['If-Modified-Since']).toBe(lastModified);
      expect(headers['If-None-Match']).toBeUndefined();
    });

    it('does not send conditional headers when the cached entry is older than the TTL', async () => {
      const cache = makeCache({
        [FLAGGED_ADDRESS]: {
          etag: '"stale"',
          lastModified: 'Wed, 21 Oct 2026 07:28:00 GMT',
          body: { is_flagged: true, lists: ['OFAC-SDN'] },
          fetchedAt: Date.now() - 60 * 60 * 1000, // 1 hour ago
        },
      });
      const fetchImpl = jest.fn().mockResolvedValue(
        makeResponseWithHeaders({ is_flagged: false, lists: [] }),
      );
      const provider = makeProvider(fetchImpl, { cache, cacheTtlMs: 60_000 });

      await provider.checkAddress(FLAGGED_ADDRESS);

      const [, init] = fetchImpl.mock.calls[0];
      const headers = init?.headers as Record<string, string>;
      expect(headers['If-None-Match']).toBeUndefined();
      expect(headers['If-Modified-Since']).toBeUndefined();
    });

    it('reuses cached data when the server responds with 304 Not Modified', async () => {
      const cache = makeCache({
        [FLAGGED_ADDRESS]: {
          etag: '"abc123"',
          lastModified: undefined,
          body: { is_flagged: true, lists: ['OFAC-SDN', 'EU-SANCTIONS'] },
          fetchedAt: Date.now(),
        },
      });
      const fetchImpl = jest.fn().mockResolvedValue(
        makeResponseWithHeaders({}, 304),
      );
      const provider = makeProvider(fetchImpl, { cache });

      const result = await provider.checkAddress(FLAGGED_ADDRESS);

      expect(result.flagged).toBe(true);
      expect(result.source).toBe('OFAC-SDN,EU-SANCTIONS');
    });

    it('updates the cache entry with new ETag and body on a 200 response', async () => {
      const cache = makeCache({
        [FLAGGED_ADDRESS]: {
          etag: '"old"',
          lastModified: undefined,
          body: { is_flagged: false, lists: [] },
          fetchedAt: Date.now(),
        },
      });
      const fetchImpl = jest.fn().mockResolvedValue(
        makeResponseWithHeaders(
          { is_flagged: true, lists: ['OFAC-SDN'] },
          200,
          { ETag: '"new-etag"', 'Last-Modified': 'Wed, 21 Oct 2026 07:28:00 GMT' },
        ),
      );
      const provider = makeProvider(fetchImpl, { cache });

      await provider.checkAddress(FLAGGED_ADDRESS);

      const entry = cache.store.get(FLAGGED_ADDRESS);
      expect(entry?.etag).toBe('"new-etag"');
      expect(entry?.lastModified).toBe('Wed, 21 Oct 2026 07:28:00 GMT');
      expect(entry?.body).toEqual({ is_flagged: true, lists: ['OFAC-SDN'] });
    });

    it('bypasses the cache entirely when cache is disabled', async () => {
      const cache = makeCache({
        [FLAGGED_ADDRESS]: {
          etag: '"abc123"',
          lastModified: undefined,
          body: { is_flagged: true, lists: ['OFAC-SDN'] },
          fetchedAt: Date.now(),
        },
      });
      const fetchImpl = jest.fn().mockResolvedValue(
        makeResponseWithHeaders({ is_flagged: false, lists: [] }),
      );
      const provider = makeProvider(fetchImpl, { cache, cacheEnabled: false });

      await provider.checkAddress(FLAGGED_ADDRESS);

      const [, init] = fetchImpl.mock.calls[0];
      const headers = init?.headers as Record<string, string>;
      expect(headers['If-None-Match']).toBeUndefined();
      expect(headers['If-Modified-Since']).toBeUndefined();
      expect(cache.get).not.toHaveBeenCalled();
    });
  });
});
