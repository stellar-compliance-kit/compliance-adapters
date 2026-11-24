/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * Provider for the UK OFSI Consolidated List.
 *
 * OFSI publishes its consolidated list as CSV. The list identifies people and
 * entities, so deployments map those entries to Stellar accounts in an
 * additional column (for example `Stellar Address`). This provider loads such
 * a CSV snapshot and flags the Stellar G... addresses it contains.
 */

import * as fs from 'fs';
import { StrKey } from '@stellar/stellar-sdk';
import { normalizeStellarAddress } from '@compliance-adapters/shared';
import { type Logger, noopLogger } from '@compliance-adapters/logger';
import type { SanctionsProvider } from './SanctionsProvider';
import { parseCsv } from './csvProvider';

/** Default source label attached to every OFSI match. */
export const OFSI_SOURCE = 'uk-ofsi-consolidated';

/** Matches candidate Stellar Ed25519 public keys inside free-form CSV cells. */
const STELLAR_ADDRESS_PATTERN = /\bG[A-Z2-7]{55}\b/gi;

export interface OfsiSanctionsProviderOptions {
  /** Source label for matches. Defaults to {@link OFSI_SOURCE}. */
  source?: string;
  /** Header of the column holding Stellar addresses. Auto-detected when omitted. */
  addressColumn?: string;
  /** Header of an optional column used to make the source more specific (e.g. OFSI Group ID). */
  sourceColumn?: string;
  /** Logger for non-fatal load problems. Defaults to a no-op logger. */
  logger?: Logger;
}

/**
 * Loads a UK OFSI consolidated-list CSV snapshot and implements
 * {@link SanctionsProvider} over the Stellar addresses found in it.
 */
export class OfsiSanctionsProvider implements SanctionsProvider {
  private readonly flaggedAddresses = new Map<string, string>();
  private readonly source: string;
  private readonly logger: Logger;

  constructor(
    private readonly csvPath: string,
    options: OfsiSanctionsProviderOptions = {},
  ) {
    this.source = options.source ?? OFSI_SOURCE;
    this.logger = options.logger ?? noopLogger;
    this.load(options.addressColumn, options.sourceColumn);
  }

  private load(addressColumnName?: string, sourceColumnName?: string): void {
    if (!fs.existsSync(this.csvPath)) {
      throw new Error(`sanctions-oracle: OFSI CSV file not found: ${this.csvPath}`);
    }

    const rows = parseCsv(fs.readFileSync(this.csvPath, 'utf-8')).filter(
      (row) => !(row.length === 1 && row[0].trim() === ''),
    );
    if (rows.length === 0) return;

    const header = rows[0].map((cell) => cell.trim().toLowerCase());
    const findColumn = (name?: string): number => {
      if (!name) return -1;
      const wanted = name.trim().toLowerCase();
      return header.findIndex((cell) => cell === wanted || cell.includes(wanted));
    };

    let addressIndex = findColumn(addressColumnName);
    if (addressIndex === -1 && !addressColumnName) {
      addressIndex = header.findIndex((cell) => cell.includes('stellar') && cell.includes('address'));
    }
    if (addressIndex === -1 && !addressColumnName) {
      addressIndex = header.findIndex((cell) => cell.includes('address'));
    }
    const sourceIndex = findColumn(sourceColumnName);

    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      const detail = sourceIndex >= 0 ? row[sourceIndex]?.trim() : undefined;
      const source = detail ? `${this.source}:${detail}` : this.source;
      // When no column is configured, scan every cell so unlabelled OFSI
      // exports still contribute any Stellar addresses they contain.
      const cells = addressIndex >= 0 ? [row[addressIndex] ?? ''] : row;
      for (const cell of cells) {
        for (const match of cell.matchAll(STELLAR_ADDRESS_PATTERN)) {
          const address = normalizeStellarAddress(match[0]);
          if (!StrKey.isValidEd25519PublicKey(address)) continue;
          if (!this.flaggedAddresses.has(address)) {
            this.flaggedAddresses.set(address, source);
          }
        }
      }
    }
  }

  async checkAddress(rawAddress: string): Promise<{ flagged: boolean; source: string }> {
    const address = normalizeStellarAddress(rawAddress);
    const source = this.flaggedAddresses.get(address);
    return source ? { flagged: true, source } : { flagged: false, source: this.source };
  }
}
