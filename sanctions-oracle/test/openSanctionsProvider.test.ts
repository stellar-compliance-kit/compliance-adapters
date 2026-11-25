import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenSanctionsProvider } from '../src/providers/openSanctionsProvider';
import { assertSanctionsProviderContract } from './helpers/sanctionsProviderContract';
import openSanctionsFixture from './fixtures/openSanctionsEntities.json';

const STELLAR_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const OTHER_STELLAR_ADDRESS = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('OpenSanctionsProvider', () => {
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchImpl = vi.fn();
  });

  describe('contract', () => {
    it('satisfies the SanctionsProvider contract', async () => {
      fetchImpl.mockResolvedValue(jsonResponse(openSanctionsFixture));
      const provider = new OpenSanctionsProvider({
        apiKey: 'test-key',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      await assertSanctionsProviderContract(provider, {
        sanctionedAddress: STELLAR_ADDRESS,
        cleanAddress: 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
      });
    });
  });

  describe('Stellar address filtering', () => {
    it('returns sanctioned for a Stellar address present in the dataset', async () => {
      fetchImpl.mockResolvedValue(jsonResponse(openSanctionsFixture));
      const provider = new OpenSanctionsProvider({
        apiKey: 'test-key',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const result = await provider.checkAddress(STELLAR_ADDRESS);
      expect(result.sanctioned).toBe(true);
      expect(result.provider).toBe('opensanctions');
    });

    it('ignores non-Stellar entities even when they share identifiers', async () => {
      fetchImpl.mockResolvedValue(jsonResponse(openSanctionsFixture));
      const provider = new OpenSanctionsProvider({
        apiKey: 'test-key',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      // The fixture contains an entity with a non-Stellar wallet identifier
      // (e.g. a Bitcoin address) that must not be treated as a Stellar match.
      const result = await provider.checkAddress('1BoatSLRHtKNngkdXEeobR76b53LETtpyT');
      expect(result.sanctioned).toBe(false);
    });

    it('returns not sanctioned for an unknown Stellar address', async () => {
      fetchImpl.mockResolvedValue(jsonResponse(openSanctionsFixture));
      const provider = new OpenSanctionsProvider({
        apiKey: 'test-key',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const result = await provider.checkAddress('GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD');
      expect(result.sanctioned).toBe(false);
    });

    it('matches multiple Stellar addresses from the dataset', async () => {
      fetchImpl.mockResolvedValue(jsonResponse(openSanctionsFixture));
      const provider = new OpenSanctionsProvider({
        apiKey: 'test-key',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const first = await provider.checkAddress(STELLAR_ADDRESS);
      const second = await provider.checkAddress(OTHER_STELLAR_ADDRESS);
      expect(first.sanctioned).toBe(true);
      expect(second.sanctioned).toBe(true);
    });
  });

  describe('API key handling', () => {
    it('sends the API key in the Authorization header', async () => {
      fetchImpl.mockResolvedValue(jsonResponse(openSanctionsFixture));
      const provider = new OpenSanctionsProvider({
        apiKey: 'secret-api-key',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      await provider.checkAddress(STELLAR_ADDRESS);

      expect(fetchImpl).toHaveBeenCalled();
      const [, init] = fetchImpl.mock.calls[0];
      const headers = new Headers((init as RequestInit).headers);
      expect(headers.get('authorization')).toBe('ApiKey secret-api-key');
    });

    it('omits the Authorization header when no API key is configured', async () => {
      fetchImpl.mockResolvedValue(jsonResponse(openSanctionsFixture));
      const provider = new OpenSanctionsProvider({
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      await provider.checkAddress(STELLAR_ADDRESS);

      const [, init] = fetchImpl.mock.calls[0];
      const headers = new Headers((init as RequestInit).headers);
      expect(headers.get('authorization')).toBeNull();
    });
  });

  describe('caching', () => {
    it('fetches the dataset once and reuses it across checks', async () => {
      fetchImpl.mockResolvedValue(jsonResponse(openSanctionsFixture));
      const provider = new OpenSanctionsProvider({
        apiKey: 'test-key',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      await provider.checkAddress(STELLAR_ADDRESS);
      await provider.checkAddress(OTHER_STELLAR_ADDRESS);
      await provider.checkAddress('GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD');

      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('refetches after the cache TTL expires', async () => {
      vi.useFakeTimers();
      try {
        fetchImpl.mockResolvedValue(jsonResponse(openSanctionsFixture));
        const provider = new OpenSanctionsProvider({
          apiKey: 'test-key',
          cacheTtlMs: 1000,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        });

        await provider.checkAddress(STELLAR_ADDRESS);
        expect(fetchImpl).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(1500);

        await provider.checkAddress(STELLAR_ADDRESS);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not cache failed responses', async () => {
      fetchImpl
        .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
        .mockResolvedValueOnce(jsonResponse(openSanctionsFixture));

      const provider = new OpenSanctionsProvider({
        apiKey: 'test-key',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      await expect(provider.checkAddress(STELLAR_ADDRESS)).rejects.toThrow();
      const result = await provider.checkAddress(STELLAR_ADDRESS);
      expect(result.sanctioned).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
  });
});