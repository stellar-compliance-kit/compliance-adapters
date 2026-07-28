/* =========================================================================
 * WARNING: PLACEHOLDER MOCK DATA — DEVELOPMENT/TESTING ONLY
 *
 * This file is a placeholder mock for development and testing ONLY. It
 * contains NO real sanctions data and must NEVER be used as a real
 * compliance data source in production.
 * ========================================================================= */

import * as fs from 'fs';
import { SanctionsProvider } from './SanctionsProvider';

const MOCK_SOURCE = 'mock-watchlist-v1';

// Fake, not cryptographically-valid StrKey addresses — they just look like
// Stellar G... public keys. Regenerate with `Keypair.random().publicKey()`
// if you need fresh-looking values.
// Exported so tests can reference a known-flagged address without
// duplicating magic strings across files.
export const MOCK_FLAGGED_ADDRESSES: Record<string, string> = {
  GHBRPOIGF3CBFNOBM2O4RAK3VRJNVGFYGWWQC5HYFSXMECOSFOGYR5XK: MOCK_SOURCE,
  GXWNREKPK5YROUDOCUZRENUN7Z5JQIPQ3ZXOI7FDHJK3EYY5QAHRVHS3: MOCK_SOURCE,
  GK5AQLGTMJXKAU7BHXTPDPFF7EII6KQ3NMTZX44HPOEVBOOAEDOECVEP: MOCK_SOURCE,
  GR7NI6P62MGG3W325DGDZVGPMM4I3LR5PE4GDAFPK276NZDKYAYQ5S37: MOCK_SOURCE,
};

export interface MockSanctionsProviderOptions {
  /**
   * Custom flagged addresses, either loaded from a JSON file or passed
   * directly. If omitted, uses MOCK_FLAGGED_ADDRESSES.
   * JSON file format: { "address": "source" } or ["address", "address", ...]
   * If an array is provided, all addresses will use MOCK_SOURCE as the source.
   */
  flaggedAddresses?: Record<string, string> | string[] | string;
}

export class MockSanctionsProvider implements SanctionsProvider {
  private flaggedAddresses: Record<string, string>;

  constructor(options?: MockSanctionsProviderOptions) {
    this.flaggedAddresses = this.loadFlaggedAddresses(options);
  }

  private loadFlaggedAddresses(options?: MockSanctionsProviderOptions): Record<string, string> {
    if (!options?.flaggedAddresses) {
      return MOCK_FLAGGED_ADDRESSES;
    }

    const flaggedAddresses = options.flaggedAddresses;

    // Handle file path (string)
    if (typeof flaggedAddresses === 'string') {
      try {
        const fileContent = fs.readFileSync(flaggedAddresses, 'utf8');
        const parsed = JSON.parse(fileContent);
        return this.normalizeAddresses(parsed);
      } catch (error) {
        throw new Error(`Failed to load flagged addresses from file ${flaggedAddresses}: ${error}`);
      }
    }

    // Handle direct object or array
    return this.normalizeAddresses(flaggedAddresses);
  }

  private normalizeAddresses(
    data: Record<string, string> | string[],
  ): Record<string, string> {
    // If it's already an object with string values, use as-is
    if (typeof data === 'object' && !Array.isArray(data)) {
      return data as Record<string, string>;
    }

    // If it's an array, convert to object with MOCK_SOURCE as value
    if (Array.isArray(data)) {
      const result: Record<string, string> = {};
      for (const address of data) {
        result[address] = MOCK_SOURCE;
      }
      return result;
    }

    throw new Error('Flagged addresses must be an object or array');
  }

  async checkAddress(address: string): Promise<{ flagged: boolean; source: string }> {
    const source = this.flaggedAddresses[address];
    if (source) {
      return { flagged: true, source };
    }
    return { flagged: false, source: MOCK_SOURCE };
  }
}
