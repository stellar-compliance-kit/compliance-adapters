/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  UnSanctionsProvider,
  parseUnSanctionsXml,
  UN_SANCTIONS_SOURCE,
} from '../src/unProvider';

const FLAGGED = 'GD7PQQDZ75ZIY3O3CZKO4P6NBRBDBYEM6PKROQUVKMXI6J2SAB4FWYAN';
const OTHER = 'GCSZ2L4YY3JHAT5ADE2DWP75QOWMKPHCWDO6FG7B6SSZOYNFXXMQHL66';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<CONSOLIDATED_LIST xmlns="urn:oasis:names:tc:ev:sc:un">
  <INDIVIDUALS>
    <INDIVIDUAL>
      <DATAID>UN-123</DATAID>
      <FIRST_NAME>Jane</FIRST_NAME>
      <SECOND_NAME>DOE</SECOND_NAME>
      <ADDRESS>Stellar account ${FLAGGED}</ADDRESS>
    </INDIVIDUAL>
    <INDIVIDUAL>
      <DATAID>UN-124</DATAID>
      <ONE_NAME>John Smith</ONE_NAME>
    </INDIVIDUAL>
  </INDIVIDUALS>
  <ENTITIES>
    <ENTITY>
      <DATAID>UN-125</DATAID>
      <ENTITY_NAME>Acme &amp; Co</ENTITY_NAME>
      <COMMENT1>Account: ${OTHER}</COMMENT1>
    </ENTITY>
  </ENTITIES>
</CONSOLIDATED_LIST>`;

describe('UnSanctionsProvider (#1009)', () => {
  it('parses individuals and entities from the UN XML feed', () => {
    const entries = parseUnSanctionsXml(XML);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ id: 'UN-123', names: ['Jane', 'DOE'] });
    expect(entries[0].addresses).toEqual([FLAGGED]);
    expect(entries[2].names).toEqual(['Acme & Co']);
    expect(entries[2].addresses).toEqual([OTHER]);
  });

  it('flags addresses found in the feed and ignores others', async () => {
    const provider = new UnSanctionsProvider(XML);
    expect(await provider.checkAddress(FLAGGED.toLowerCase())).toEqual({
      flagged: true,
      source: UN_SANCTIONS_SOURCE,
    });
    expect((await provider.checkAddress('GNOTLISTED')).flagged).toBe(false);
  });

  it('loads a local XML file and supports a custom source label', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'un-xml-'));
    const file = path.join(dir, 'un.xml');
    fs.writeFileSync(file, XML);
    const provider = new UnSanctionsProvider({ filePath: file, source: 'un-custom' });
    expect((await provider.checkAddress(FLAGGED)).source).toBe('un-custom');
  });

  it('loads the feed through an injected fetch implementation', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, text: async () => XML })) as never;
    const provider = await UnSanctionsProvider.fromUrl('https://example.com/un.xml', fetchImpl);
    expect((await provider.checkAddress(FLAGGED)).flagged).toBe(true);
  });
});
