/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  EuSanctionsProvider,
  parseEuSanctionsXml,
  EU_SANCTIONS_SOURCE,
} from '../src/euProvider';

const FLAGGED = 'GCSNJ6SE42RKXVFLWHFWRZKAWOVSTVVTZ2HBM2JV45NY3GGMB6PJBMXX';
const OTHER = 'GCSZ2L4YY3JHAT5ADE2DWP75QOWMKPHCWDO6FG7B6SSZOYNFXXMQHL66';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<eu:euSanctionsList xmlns:eu="http://europa.eu/sanctions">
  <eu:snapshotDate>2026-11-24</eu:snapshotDate>
  <eu:entityList>
    <eu:entity>
      <eu:entityId>EU-42</eu:entityId>
      <eu:name>Example &amp; Sons</eu:name>
      <eu:entityType>individual</eu:entityType>
      <eu:address>
        <eu:street>1 Main Street</eu:street>
        <eu:city>Brussels</eu:city>
        <eu:cryptoAddress>${FLAGGED}</eu:cryptoAddress>
      </eu:address>
    </eu:entity>
    <eu:entity>
      <eu:entityId>EU-43</eu:entityId>
      <eu:name>Other Person</eu:name>
    </eu:entity>
  </eu:entityList>
</eu:euSanctionsList>`;

describe('EuSanctionsProvider (#1010)', () => {
  it('parses EU FSF XML records including namespaced fields', () => {
    const entries = parseEuSanctionsXml(XML);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ id: 'EU-42', names: ['Example & Sons'] });
    expect(entries[0].addresses).toEqual([FLAGGED]);
    expect(entries[1].addresses).toEqual([]);
  });

  it('flags only listed addresses', async () => {
    const provider = new EuSanctionsProvider(XML);
    expect(await provider.checkAddress(FLAGGED.toLowerCase())).toEqual({
      flagged: true,
      source: EU_SANCTIONS_SOURCE,
    });
    expect((await provider.checkAddress(OTHER)).flagged).toBe(false);
  });

  it('loads from a file and through an injected fetch', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eu-xml-'));
    const file = path.join(dir, 'eu.xml');
    fs.writeFileSync(file, XML);
    const fromFile = new EuSanctionsProvider({ filePath: file, source: 'eu-custom' });
    expect((await fromFile.checkAddress(FLAGGED)).source).toBe('eu-custom');

    const fetchImpl = jest.fn(async () => ({ ok: true, text: async () => XML })) as never;
    const fromFetch = await EuSanctionsProvider.fromUrl('https://example.com/eu.xml', fetchImpl);
    expect((await fromFetch.checkAddress(FLAGGED)).flagged).toBe(true);
  });
});
