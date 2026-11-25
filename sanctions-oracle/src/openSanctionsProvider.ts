import { StrKey } from '@stellar/stellar-sdk';
import {
  SanctionsProvider,
  SanctionsProviderOptions,
  SanctionsCheckResult,
} from './types';

/**
 * Options for the OpenSanctionsProvider.
 */
export interface OpenSanctionsProviderOptions extends SanctionsProviderOptions {
  /**
   * OpenSanctions API key. Falls back to the OPENSANCTIONS_API_KEY env var.
   */
  apiKey?: string;
  /**
   * Base URL for the OpenSanctions API. Defaults to https://api.opensanctions.org.
   */
  baseUrl?: string;
  /**
   * Dataset(s) to query. Defaults to a broad set covering crypto/sanctions lists.
   */
  datasets?: string[];
  /**
   * Cache TTL in milliseconds. Defaults to 1 hour.
   */
  cacheTtlMs?: number;
  /**
   * Injectable fetch implementation (for testing).
   */
  fetchImpl?: typeof fetch;
  /**
   * Request timeout in milliseconds. Defaults to 10000.
   */
  timeoutMs?: number;
}

interface CacheEntry {
  result: SanctionsCheckResult;
  expiresAt: number;
}

interface OpenSanctionsEntity {
  id?: string;
  caption?: string;
  datasets?: string[];
  properties?: Record<string, unknown>;
  referents?: string[];
}

interface OpenSanctionsSearchResponse {
  results?: OpenSanctionsEntity[];
}

const DEFAULT_BASE_URL = 'https://api.opensanctions.org';
const DEFAULT_DATASETS = ['sanctions', 'crypto'];
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Normalizes a Stellar address to its canonical form for comparison.
 */
export function normalizeStellarAddress(address: string): string {
  return address.trim().toUpperCase();
}

/**
 * Returns true if the given string is a valid Stellar Ed25519 public key.
 */
export function isValidStellarAddress(address: string): boolean {
  if (!address) {
    return false;
  }
  try {
    return StrKey.isValidEd25519PublicKey(address.trim());
  } catch {
    return false;
  }
}

/**
 * Sanctions provider backed by the OpenSanctions API.
 *
 * OpenSanctions aggregates many official lists (including crypto wallet
 * identifiers) behind a single API. This provider queries the API for a given
 * Stellar address, filters entities to valid Stellar addresses, and caches
 * results in memory.
 */
export class OpenSanctionsProvider implements SanctionsProvider {
  readonly name = 'opensanctions';

  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly datasets: string[];
  private readonly cacheTtlMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: OpenSanctionsProviderOptions = {}) {
    this.apiKey =
      options.apiKey ?? process.env.OPENSANCTIONS_API_KEY ?? undefined;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.datasets =
      options.datasets && options.datasets.length > 0
        ? options.datasets
        : DEFAULT_DATASETS;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Checks whether the given Stellar address is flagged by OpenSanctions.
   */
  async check(address: string): Promise<SanctionsCheckResult> {
    if (!isValidStellarAddress(address)) {
      return { flagged: false, source: 'opensanctions:invalid-address' };
    }

    const normalized = normalizeStellarAddress(address);
    const cached = this.getFromCache(normalized);
    if (cached) {
      return cached;
    }

    const result = await this.query(normalized);
    this.setCache(normalized, result);
    return result;
  }

  private getFromCache(key: string): SanctionsCheckResult | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.result;
  }

  private setCache(key: string, result: SanctionsCheckResult): void {
    this.cache.set(key, {
      result,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  /**
   * Clears the in-memory cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  private async query(normalizedAddress: string): Promise<SanctionsCheckResult> {
    const url = new URL(`${this.baseUrl}/search/default`);
    url.searchParams.set('q', normalizedAddress);
    url.searchParams.set('limit', '10');
    if (this.datasets.length > 0) {
      url.searchParams.set('datasets', this.datasets.join(','));
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (this.apiKey) {
      headers.Authorization = `ApiKey ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(
        `OpenSanctions request failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(
        `OpenSanctions request failed with status ${response.status}`,
      );
    }

    const body = (await response.json()) as OpenSanctionsSearchResponse;
    const entities = body.results ?? [];

    const matched = entities.filter((entity) =>
      this.entityMatchesAddress(entity, normalizedAddress),
    );

    if (matched.length === 0) {
      return { flagged: false, source: 'opensanctions' };
    }

    const datasetSet = new Set<string>();
    for (const entity of matched) {
      for (const dataset of entity.datasets ?? []) {
        datasetSet.add(dataset);
      }
    }
    const source =
      datasetSet.size > 0
        ? `opensanctions:${Array.from(datasetSet).sort().join(',')}`
        : 'opensanctions';

    return { flagged: true, source };
  }

  /**
   * Determines whether an OpenSanctions entity references the given Stellar
   * address. Only valid Stellar addresses are considered matches.
   */
  private entityMatchesAddress(
    entity: OpenSanctionsEntity,
    normalizedAddress: string,
  ): boolean {
    const candidates = this.collectAddressCandidates(entity);
    for (const candidate of candidates) {
      if (!isValidStellarAddress(candidate)) {
        continue;
      }
      if (normalizeStellarAddress(candidate) === normalizedAddress) {
        return true;
      }
    }
    return false;
  }

  private collectAddressCandidates(entity: OpenSanctionsEntity): string[] {
    const candidates: string[] = [];
    const props = entity.properties ?? {};

    const addressKeys = [
      'cryptoWalletAddress',
      'cryptoWalletAddresses',
      'walletAddress',
      'walletAddresses',
      'publicKey',
      'publicKeys',
      'address',
      'addresses',
      'stellarAddress',
      'stellarAddresses',
    ];

    for (const key of addressKeys) {
      const value = props[key];
      if (value === undefined || value === null) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string') {
            candidates.push(item);
          }
        }
      } else if (typeof value === 'string') {
        candidates.push(value);
      }
    }

    if (entity.caption) {
      candidates.push(entity.caption);
    }

    return candidates;
  }
}