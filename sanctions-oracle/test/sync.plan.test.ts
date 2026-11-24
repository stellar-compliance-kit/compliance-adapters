/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Keypair } from '@stellar/stellar-sdk';
import {
  parseArgs,
  runCli,
  syncSanctionsToDenylist,
  DenylistWriter,
  SyncResult,
} from '../src/sync';
import type { SanctionsProvider } from '../src/SanctionsProvider';

const FLAGGED = Keypair.random().publicKey();
const CLEARED = Keypair.random().publicKey();
const UNCHANGED = Keypair.random().publicKey();

function tempFile(name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanctions-plan-test-'));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

const provider: SanctionsProvider = {
  checkAddress: jest.fn(async (address: string) => ({
    flagged: address === FLAGGED || address === UNCHANGED,
    source: 'ofac-sdn',
  })),
};

describe('plan mode', () => {
  it('returns adds/removes with sources and performs no writes', async () => {
    const writer: DenylistWriter = {
      addToDenylist: jest.fn(async () => ({ hash: 'add' })),
      removeFromDenylist: jest.fn(async () => ({ hash: 'rm' })),
    };

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED, UNCHANGED],
      writer,
      currentDenylist: [CLEARED, UNCHANGED],
      reconcile: true,
      plan: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.written).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.plan).toEqual({
      adds: [{ address: FLAGGED, source: 'ofac-sdn' }],
      removes: [{ address: CLEARED, source: 'ofac-sdn' }],
    });
    expect(writer.addToDenylist).not.toHaveBeenCalled();
    expect(writer.removeFromDenylist).not.toHaveBeenCalled();
  });

  it('parses --plan and produces machine-readable JSON on the CLI', async () => {
    expect(parseArgs(['--plan', '--json'])).toEqual(
      expect.objectContaining({ plan: true, json: true }),
    );

    const addressesPath = tempFile('addresses.json', JSON.stringify([FLAGGED, UNCHANGED]));
    const csvPath = tempFile('list.csv', `address,source\n${FLAGGED},ofac-sdn\n`);
    const snapshotPath = tempFile('snapshot.json', JSON.stringify([CLEARED]));
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const originalExitCode = process.exitCode;
    try {
      await runCli([
        '--addresses', addressesPath,
        '--csv', csvPath,
        '--denylist-snapshot', snapshotPath,
        '--plan',
        '--json',
      ]);
      const payload = JSON.parse(logSpy.mock.calls[logSpy.mock.calls.length - 1][0] as string) as SyncResult;
      expect(payload.plan?.adds).toEqual([{ address: FLAGGED, source: 'ofac-sdn' }]);
      expect(payload.plan?.removes).toHaveLength(1);
      expect(payload.plan?.removes?.[0].address).toBe(CLEARED);
      expect(payload.written).toEqual([]);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      process.exitCode = originalExitCode;
    }
  });
});
