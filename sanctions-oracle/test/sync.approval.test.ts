/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import {
  EXIT_CODE_APPROVAL_REQUIRED,
  parseArgs,
  runCli,
  syncSanctionsToDenylist,
  DenylistWriter,
} from '../src/sync';
import type { SanctionsProvider } from '../src/SanctionsProvider';

function makeWriter(): DenylistWriter & { addToDenylist: jest.Mock } {
  return {
    addToDenylist: jest.fn(async () => ({ hash: 'add' })),
  };
}

function tempFile(name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanctions-approval-test-'));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe('large sync approval threshold', () => {
  it('pauses with no writes when the proposed writes exceed the threshold', async () => {
    const addresses = Array.from({ length: 25 }, () => Keypair.random().publicKey());
    const provider: SanctionsProvider = {
      checkAddress: jest.fn(async () => ({ flagged: true, source: 'buggy-provider' })),
    };
    const writer = makeWriter();

    const result = await syncSanctionsToDenylist({
      provider,
      addresses,
      writer,
      maxAutoWrites: 10,
    });

    expect(result.approvalRequired).toBe(true);
    expect(result.approvalRequiredCount).toBe(25);
    expect(result.approvalThreshold).toBe(10);
    expect(result.written).toEqual([]);
    expect(writer.addToDenylist).not.toHaveBeenCalled();
  });

  it('writes normally when the threshold is not exceeded', async () => {
    const address = Keypair.random().publicKey();
    const writer = makeWriter();
    const result = await syncSanctionsToDenylist({
      provider: { checkAddress: async () => ({ flagged: true, source: 'ofac-sdn' }) },
      addresses: [address],
      writer,
      maxAutoWrites: 10,
    });

    expect(result.approvalRequired).toBeUndefined();
    expect(result.written).toEqual([address]);
    expect(writer.addToDenylist).toHaveBeenCalledTimes(1);
  });

  it('exits with the dedicated approval code from the CLI', async () => {
    expect(parseArgs(['--approval-threshold', '1']).approvalThreshold).toBe(1);
    const addresses = [Keypair.random().publicKey(), Keypair.random().publicKey()];
    const addressesPath = tempFile('addresses.json', JSON.stringify(addresses));
    const csvPath = tempFile('list.csv', `address,source\n${addresses.join('\n')},ofac-sdn\n`);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const originalExitCode = process.exitCode;
    try {
      await runCli([
        '--addresses', addressesPath,
        '--csv', csvPath,
        '--contract-id', StrKey.encodeContract(Buffer.alloc(32, 1)),
        '--rpc-url', 'http://localhost:8000',
        '--network-passphrase', 'Test SDF Network ; September 2015',
        '--secret-key', Keypair.random().secret(),
        '--approval-threshold', '1',
      ]);
      expect(process.exitCode).toBe(EXIT_CODE_APPROVAL_REQUIRED);
      const payload = JSON.parse(logSpy.mock.calls[logSpy.mock.calls.length - 1][0] as string);
      expect(payload.approvalRequired).toBe(true);
      expect(payload.written).toEqual([]);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      process.exitCode = originalExitCode;
    }
  });
});
