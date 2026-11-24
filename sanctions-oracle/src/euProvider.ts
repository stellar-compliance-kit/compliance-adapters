/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * @file euProvider.ts
 *
 * Provider for the EU consolidated financial sanctions list (FSF) XML feed.
 * Namespaced (`<eu:...>`) and default-namespace documents are both supported;
 * Stellar public keys found in listed addresses are used for screening.
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

export const EU_SANCTIONS_SOURCE = 'eu-consolidated-list';

/** One parsed EU FSF list entry. */
export interface EuSanctionsEntry {
  id: string;
  names: string[];
  addresses: string[];
}

export interface EuSanctionsProviderOptions {
  /** Raw EU FSF XML content. */
  xml?: string;
  /** Path to a local XML file (used when `xml` is not supplied). */
  filePath?: string;
  /** Source label reported in check results. */
  source?: string;
}

/** Parses `<entity>`/`<sanctionsEntity>` records from an EU FSF XML feed. */
export function parseEuSanctionsXml(xml: string): EuSanctionsEntry[] {
  const entries: EuSanctionsEntry[] = [];
  const seen = new Set<string>();
  const records = [
    ...xmlRecords(xml, 'sanctionsEntity'),
    ...xmlRecords(xml, 'entity'),
    ...xmlRecords(xml, 'entry'),
  ];
  for (const record of records) {
    if (seen.has(record)) continue;
    seen.add(record);
    const names = [
      ...xmlElements(record, 'name'),
      ...xmlElements(record, 'name1'),
      ...xmlElements(record, 'name2'),
      ...xmlElements(record, 'name3'),
      ...xmlElements(record, 'fullName'),
      ...xmlElements(record, 'entityName'),
      ...xmlElements(record, 'organisationName'),
      ...xmlElements(record, 'lastName'),
      ...xmlElements(record, 'firstName'),
    ]
      .map(xmlText)
      .filter(Boolean);
    const rawAddresses = [
      ...xmlElements(record, 'address'),
      ...xmlElements(record, 'street'),
      ...xmlElements(record, 'city'),
      ...xmlElements(record, 'cryptoAddress'),
      ...xmlElements(record, 'comments'),
    ].join(' ');
    const addresses = extractStellarAddresses(rawAddresses);
    const id =
      xmlElements(record, 'entityId').map(xmlText)[0] ??
      xmlElements(record, 'id').map(xmlText)[0] ??
      names.join(' ') ??
      `eu-${entries.length + 1}`;
    entries.push({ id, names, addresses });
  }
  return entries;
}

/** Flags Stellar addresses listed in an EU FSF XML document. */
export class EuSanctionsProvider implements SanctionsProvider {
  private readonly flagged = new Set<string>();
  private readonly source: string;
  readonly entries: EuSanctionsEntry[];

  constructor(xmlOrOptions: string | EuSanctionsProviderOptions) {
    const options =
      typeof xmlOrOptions === 'string'
        ? { xml: xmlOrOptions.trimStart().startsWith('<') ? xmlOrOptions : undefined, filePath: xmlOrOptions }
        : xmlOrOptions;
    if (!options.xml && !options.filePath) {
      throw new Error('EuSanctionsProvider requires XML content or a filePath');
    }
    this.source = options.source ?? EU_SANCTIONS_SOURCE;
    const xml = options.xml ?? readXmlFile(options.filePath as string);
    this.entries = parseEuSanctionsXml(xml);
    for (const entry of this.entries) {
      for (const address of entry.addresses) this.flagged.add(normalizeStellarAddress(address));
    }
  }

  async checkAddress(address: string): Promise<CheckResult> {
    const flagged = this.flagged.has(normalizeStellarAddress(address));
    return { flagged, source: flagged ? this.source : EU_SANCTIONS_SOURCE };
  }

  /** Fetch helper for callers that want to load the published feed themselves. */
  static async fromUrl(
    url: string,
    fetchImpl: typeof fetch = fetch,
  ): Promise<EuSanctionsProvider> {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`Failed to fetch EU sanctions XML: ${response.status}`);
    return new EuSanctionsProvider({ xml: await response.text(), source: EU_SANCTIONS_SOURCE });
  }
}
