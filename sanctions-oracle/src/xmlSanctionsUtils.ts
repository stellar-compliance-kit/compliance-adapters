/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * Small dependency-free helpers for reading sanctions XML feeds. Namespaced
 * tags (`<eu:name>`, `<un:...>`) are matched by their local name so providers
 * work with both prefixed and default-namespace documents.
 */

/** Decodes the five predefined XML entities plus numeric character references. */
export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)));
}

/** Removes a namespace prefix and any XML declarations/comments/cdata wrappers. */
export function xmlText(value: string): string {
  return decodeXmlEntities(
    value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

/**
 * Returns the text content of every element with the given local name.
 * Handles optional namespace prefixes and arbitrary attributes.
 */
export function xmlElements(xml: string, localName: string): string[] {
  const escaped = localName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?${escaped}\\s*>`,
    'gi',
  );
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) results.push(match[1]);
  return results;
}

/** Returns the full outer XML of repeated record elements with a local name. */
export function xmlRecords(xml: string, localName: string): string[] {
  const escaped = localName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${escaped}(?:\\s[^>]*)?>[\\s\\S]*?<\\/(?:[A-Za-z_][\\w.-]*:)?${escaped}\\s*>`,
    'gi',
  );
  return xml.match(re) ?? [];
}

/** Finds Stellar public keys anywhere in a block of XML or plain text. */
export function extractStellarAddresses(value: string): string[] {
  const found = value.match(/\b[Gg][A-Za-z2-7]{55}\b/g) ?? [];
  return [...new Set(found.map((address) => address.toUpperCase()))];
}

/** Reads XML from a path synchronously (useful for offline/local feeds). */
export function readXmlFile(filePath: string): string {
  // Lazy require keeps browser bundles free of a hard `fs` dependency.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs') as typeof import('fs');
  return fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
}
