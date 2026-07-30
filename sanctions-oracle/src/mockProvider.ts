/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/* =========================================================================
 * WARNING: PLACEHOLDER MOCK DATA — DEVELOPMENT/TESTING ONLY
 *
 * This file is a placeholder mock for development and testing ONLY. It
 * contains NO real sanctions data and must NEVER be used as a real
 * compliance data source in production.
 * ========================================================================= */

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

export class MockSanctionsProvider implements SanctionsProvider {
  async checkAddress(address: string): Promise<{ flagged: boolean; source: string }> {
    const source = MOCK_FLAGGED_ADDRESSES[address];
    if (source) {
      return { flagged: true, source };
    }
    return { flagged: false, source: MOCK_SOURCE };
  }
}
