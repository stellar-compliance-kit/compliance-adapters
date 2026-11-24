/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Keypair } from '@stellar/stellar-sdk';
import { OFSI_SOURCE, OfsiSanctionsProvider } from '../src/ofsiProvider';

function writeTempCsv(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofsi-provider-test-'));
  const filePath = path.join(dir, 'ConList.csv');
  fs.writeFileSync(filePath, content);
  return filePath;
}

const FLAGGED = Keypair.random().publicKey();
const OTHER = Keypair.random().publicKey();

describe('OfsiSanctionsProvider', () => {
  it('flags Stellar addresses from an OFSI consolidated CSV and reports the source', async () => {
    const csvPath = writeTempCsv(
      `Group ID,Name,Stellar Address\n1234,Example Entity,${FLAGGED}\n`,
    );
    const provider = new OfsiSanctionsProvider(csvPath, { sourceColumn: 'Group ID' });

    expect(await provider.checkAddress(FLAGGED)).toEqual({
      flagged: true,
      source: `${OFSI_SOURCE}:1234`,
    });
    expect(await provider.checkAddress(OTHER)).toEqual({ flagged: false, source: OFSI_SOURCE });
  });

  it('normalizes lowercase/whitespace addresses and finds addresses in free-form cells', async () => {
    const csvPath = writeTempCsv(`Group ID,Details\n1234,"see ${FLAGGED.toLowerCase()}"\n`);
    const provider = new OfsiSanctionsProvider(csvPath);

    expect((await provider.checkAddress(`  ${FLAGGED.toLowerCase()}  `)).flagged).toBe(true);
  });

  it('skips invalid addresses and honors an explicit address column', async () => {
    const csvPath = writeTempCsv(
      `Name,Stellar Address,Notes\nBad,NOT-AN-ADDRESS,${FLAGGED}\n`,
    );
    const provider = new OfsiSanctionsProvider(csvPath, { addressColumn: 'Stellar Address' });

    expect((await provider.checkAddress(FLAGGED)).flagged).toBe(false);
    expect((await provider.checkAddress('NOT-AN-ADDRESS')).flagged).toBe(false);
  });

  it('fails loudly when the configured list is missing', () => {
    expect(() => new OfsiSanctionsProvider('/nonexistent/ofsi.csv')).toThrow(/OFSI CSV file not found/);
  });
});
