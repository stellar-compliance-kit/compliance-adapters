/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * @file unProvider.ts
 *
 * Provider for the UN Security Council Consolidated List XML feed.
 * It extracts listed individuals/entities and any Stellar public keys present
 * in their identity/address fields, so the sync engine can screen addresses
 * against the UN list without a network dependency.
 */

import type { CheckResult, SanctionsProvider } from './SanctionsProvider';
import { normalizeStellarAddress } from '@compliance-adapters/shared';
import {
  extractStellarAddresses,
  readXmlFile,
  xmlElements,
  xmlRecords,
  xmlText,
} from './xmlSanctionsUtils';

export const UN_SANCTIONS_SOURCE = 'un-consolidated-list';

/** One parsed UN list entry. */
export interface UnSanctionsEntry {
  id: string;
  names: string[];
  addresses: string[];
}

export interface UnSanctionsProviderOptions {
  /** Raw XML feed content. */
  xml?: string;
  /** Path to a local XML file (used when `xml` is not supplied). */
  filePath?: string;
  /** Source label reported in check results. */
  source?: string;
}

/** Parses `<INDIVIDUAL>` and `<ENTITY>` records from a UN consolidated XML feed. */
export function parseUnSanctionsXml(xml: string): UnSanctionsEntry[] {
  const entries: UnSanctionsEntry[] = [];
  const records = [...xmlRecords(xml, 'INDIVIDUAL'), ...xmlRecords(xml, 'ENTITY')];
  for (const record of records) {
    const names = [
      ...xmlElements(record, 'FIRST_NAME'),
      ...xmlElements(record, 'SECOND_NAME'),
      ...xmlElements(record, 'THIRD_NAME'),
      ...xmlElements(record, 'FOURTH_NAME'),
      ...xmlElements(record, 'ONE_NAME'),
      ...xmlElements(record, 'TWO_NAME'),
      ...xmlElements(record, 'THREE_NAME'),
      ...xmlElements(record, 'ENTITY_NAME'),
    ]
      .map(xmlText)
      .filter(Boolean);
    const rawAddresses = [
      ...xmlElements(record, 'ADDRESS'),
      ...xmlElements(record, 'STREET'),
      ...xmlElements(record, 'CITY'),
      ...xmlElements(record, 'COMMENT1'),
      ...xmlElements(record, 'COMMENT2'),
    ].join(' ');
    const addresses = extractStellarAddresses(rawAddresses);
    const dataId = xmlElements(record, 'DATAID').map(xmlText)[0] ?? '';
    entries.push({
      id: dataId || names.join(' ') || `un-${entries.length + 1}`,
      names,
      addresses,
    });
  }
  return entries;
}

/**
 * Loads a UN XML feed (from a string or file) and flags Stellar addresses
 * found in listed entries. XML parsing failure is thrown so callers do not
 * silently screen against an empty list.
 */
export class UnSanctionsProvider implements SanctionsProvider {
  private readonly flagged = new Set<string>();
  private readonly source: string;
  readonly entries: UnSanctionsEntry[];

  constructor(xmlOrOptions: string | UnSanctionsProviderOptions) {
    const options =
      typeof xmlOrOptions === 'string'
        ? { xml: xmlOrOptions.trimStart().startsWith('<') ? xmlOrOptions : undefined, filePath: xmlOrOptions }
        : xmlOrOptions;
    if (!options.xml && !options.filePath) {
      throw new Error('UnSanctionsProvider requires XML content or a filePath');
    }
    this.source = options.source ?? UN_SANCTIONS_SOURCE;
    const xml = options.xml ?? readXmlFile(options.filePath as string);
    this.entries = parseUnSanctionsXml(xml);
    for (const entry of this.entries) {
      for (const address of entry.addresses) this.flagged.add(normalizeStellarAddress(address));
    }
  }

  async checkAddress(address: string): Promise<CheckResult> {
    const flagged = this.flagged.has(normalizeStellarAddress(address));
    return { flagged, source: flagged ? this.source : UN_SANCTIONS_SOURCE };
  }

  /** Fetch helper for callers that want to load the published feed themselves. */
  static async fromUrl(
    url: string,
    fetchImpl: typeof fetch = fetch,
  ): Promise<UnSanctionsProvider> {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`Failed to fetch UN sanctions XML: ${response.status}`);
    return new UnSanctionsProvider({ xml: await response.text(), source: UN_SANCTIONS_SOURCE });
  }
}
