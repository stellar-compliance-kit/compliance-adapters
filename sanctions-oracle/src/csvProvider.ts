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
import { StrKey } from '@stellar/stellar-sdk';
import { type Logger, consoleLogger } from '@compliance-adapters/logger';
import * as fs from 'fs';

const CSV_SOURCE = 'csv-watchlist-v1';

export interface CsvSanctionsProviderOptions {
  /**
   * Logger used to report non-fatal load problems (missing file, invalid rows,
   * read failures). Defaults to {@link consoleLogger} so standalone use still
   * surfaces warnings. Pass `noopLogger` or a custom `Logger` to silence or
   * redirect this output when embedding the provider programmatically.
   */
  logger?: Logger;
}

export class CsvSanctionsProvider implements SanctionsProvider {
  private flaggedAddresses: Map<string, string> = new Map();
  private readonly logger: Logger;

  constructor(
    private csvPath: string,
    options: CsvSanctionsProviderOptions = {},
  ) {
    this.logger = options.logger ?? consoleLogger;
    this.loadCsv();
  }

  private loadCsv(): void {
    try {
      if (!fs.existsSync(this.csvPath)) {
        this.logger.warn(
          `sanctions-oracle: CSV file not found at path: ${this.csvPath}, no addresses will be flagged`,
        );
        return;
      }

      const content = fs.readFileSync(this.csvPath, 'utf-8');
      const lines = content.trim().split('\n');

      // Skip header row
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(',');
        if (parts.length >= 1) {
          const address = parts[0].trim();
          if (!StrKey.isValidEd25519PublicKey(address)) {
            this.logger.warn(
              `sanctions-oracle: skipping invalid address at line ${i + 1} of ${this.csvPath}: "${address}" is not a valid Stellar G... address`,
            );
            continue;
          }
          const source = parts.length >= 2 ? parts[1].trim() : CSV_SOURCE;
          this.flaggedAddresses.set(address, source);
        }
      }
    } catch (error) {
      this.logger.warn(
        `sanctions-oracle: Failed to load CSV from ${this.csvPath}: ${error instanceof Error ? error.message : String(error)}, no addresses will be flagged`,
      );
    }
  }

  async checkAddress(address: string): Promise<{ flagged: boolean; source: string }> {
    const source = this.flaggedAddresses.get(address);
    if (source) {
      return { flagged: true, source };
    }
    return { flagged: false, source: CSV_SOURCE };
  }
}
