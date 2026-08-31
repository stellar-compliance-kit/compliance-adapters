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
import * as fs from 'fs';

const CSV_SOURCE = 'csv-watchlist-v1';

/**
 * Parse CSV `content` into an array of records (rows), each record being an
 * array of field strings.
 *
 * This is a small, dependency-free RFC 4180-aware parser. It handles:
 *   - quoted fields (`"..."`) that may contain commas, `\r`, `\n`
 *   - escaped quotes inside quoted fields (`""` -> `"`)
 *   - `\n`, `\r\n` and bare `\r` line endings
 *   - a leading UTF-8 BOM
 *   - completely blank lines (skipped)
 *
 * It never throws on malformed input: an unterminated quoted field is closed
 * implicitly at end-of-input, so callers always get a best-effort parse
 * rather than an exception.
 */
export function parseCsv(content: string): string[][] {
  // Strip a leading UTF-8 BOM if present.
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  // Tracks whether the current record has seen any content at all, so we can
  // distinguish a genuine empty row ("") from a blank line to be skipped.
  let recordHasContent = false;

  const endField = (): void => {
    record.push(field);
    field = '';
  };

  const endRecord = (): void => {
    endField();
    records.push(record);
    record = [];
    recordHasContent = false;
  };

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];

    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      recordHasContent = true;
    } else if (ch === ',') {
      endField();
      recordHasContent = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && content[i + 1] === '\n') {
        i++;
      }
      if (recordHasContent || field.length > 0) {
        endRecord();
      } else {
        // Blank line — reset any partial state and skip it entirely.
        record = [];
      }
    } else {
      field += ch;
      recordHasContent = true;
    }
  }

  // Flush any trailing field/record that wasn't terminated by a line ending.
  if (recordHasContent || field.length > 0 || record.length > 0) {
    endRecord();
  }

  return records;
}

export class CsvSanctionsProvider implements SanctionsProvider {
  /**
   * Maps a flagged address to the list of distinct source attributions seen
   * for it in the CSV. An address that appears on multiple rows accumulates
   * every distinct source rather than the last one silently overwriting the
   * earlier ones (see the "Duplicate addresses" section of the package
   * README).
   */
  private flaggedAddresses: Map<string, string[]> = new Map();

  constructor(private csvPath: string) {
    this.loadCsv();
  }

  private loadCsv(): void {
    try {
      if (!fs.existsSync(this.csvPath)) {
        console.warn(
          `sanctions-oracle: CSV file not found at path: ${this.csvPath}, no addresses will be flagged`,
        );
        return;
      }

      const content = fs.readFileSync(this.csvPath, 'utf-8');
      const records = parseCsv(content);

      // Skip header row (records[0]).
      for (let i = 1; i < records.length; i++) {
        const parts = records[i];
        if (parts.length === 0) continue;

        const address = (parts[0] ?? '').trim();
        if (!address) continue;

        if (!StrKey.isValidEd25519PublicKey(address)) {
          console.warn(
            `sanctions-oracle: skipping invalid address at row ${i + 1} of ${this.csvPath}: "${address}" is not a valid Stellar G... address`,
          );
          continue;
        }

        const rawSource = parts.length >= 2 ? parts[1].trim() : '';
        const source = rawSource || CSV_SOURCE;

        const existing = this.flaggedAddresses.get(address);
        if (existing === undefined) {
          this.flaggedAddresses.set(address, [source]);
          continue;
        }

        if (existing.includes(source)) {
          console.warn(
            `sanctions-oracle: address "${address}" appears more than once in ${this.csvPath} with source "${source}"; the duplicate row was ignored`,
          );
        } else {
          existing.push(source);
          console.warn(
            `sanctions-oracle: address "${address}" appears more than once in ${this.csvPath} with differing sources; ` +
              `aggregating attributions as "${existing.join(',')}"`,
          );
        }
      }
    } catch (error) {
      console.warn(
        `sanctions-oracle: Failed to load CSV from ${this.csvPath}: ${error instanceof Error ? error.message : String(error)}, no addresses will be flagged`,
      );
    }
  }

  async checkAddress(address: string): Promise<{ flagged: boolean; source: string }> {
    const sources = this.flaggedAddresses.get(address);
    if (sources && sources.length > 0) {
      return { flagged: true, source: sources.join(',') };
    }
    return { flagged: false, source: CSV_SOURCE };
  }
}
