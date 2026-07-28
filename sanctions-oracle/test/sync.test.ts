import * as fs from 'fs';
import { syncSanctionsToDenylist, DenylistWriter, parseArgs, CliArgs, runCli } from '../src/sync';
import { MockSanctionsProvider, MOCK_FLAGGED_ADDRESSES } from '../src/mockProvider';

const FLAGGED_ADDRESS = Object.keys(MOCK_FLAGGED_ADDRESSES)[0];
const CLEAN_ADDRESS = 'GDNOTPRESENTINANYMOCKWATCHLISTAAAAAAAAAAAAAAAAAAAAAAAAAA';

function makeFakeWriter(): DenylistWriter & { addToDenylist: jest.Mock } {
  return {
    addToDenylist: jest.fn().mockResolvedValue({ hash: 'fakehash' }),
  };
}

describe('syncSanctionsToDenylist', () => {
  it('dry-run mode: never calls the writer and reports would-be writes as empty', async () => {
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESS, CLEAN_ADDRESS],
      writer,
      dryRun: true,
    });

    expect(writer.addToDenylist).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.checked).toBe(2);
    expect(result.flagged).toEqual([FLAGGED_ADDRESS]);
    expect(result.written).toEqual([]);
  });

  it('live mode: calls the writer once per flagged address and records the writes', async () => {
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESS, CLEAN_ADDRESS],
      writer,
      dryRun: false,
    });

    expect(writer.addToDenylist).toHaveBeenCalledTimes(1);
    expect(writer.addToDenylist).toHaveBeenCalledWith(FLAGGED_ADDRESS);
    expect(result.dryRun).toBe(false);
    expect(result.checked).toBe(2);
    expect(result.flagged).toEqual([FLAGGED_ADDRESS]);
    expect(result.written).toEqual([FLAGGED_ADDRESS]);
  });

  it('live mode omitting dryRun defaults to actually writing', async () => {
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESS],
      writer,
    });

    expect(writer.addToDenylist).toHaveBeenCalledTimes(1);
    expect(result.written).toEqual([FLAGGED_ADDRESS]);
  });

  it('deduplicates input addresses before checking', async () => {
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();
    const checkSpy = jest.spyOn(provider, 'checkAddress');

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESS, FLAGGED_ADDRESS, CLEAN_ADDRESS, FLAGGED_ADDRESS],
      writer,
      dryRun: false,
    });

    expect(checkSpy).toHaveBeenCalledTimes(2);
    expect(result.checked).toBe(2);
    expect(result.flagged).toEqual([FLAGGED_ADDRESS]);
    expect(writer.addToDenylist).toHaveBeenCalledTimes(1);
  });
});

describe('parseArgs', () => {
  it('parses all recognized flags', () => {
    const result = parseArgs([
      '--addresses', '/path/to/addresses.json',
      '--dry-run',
      '--contract-id', 'CBSXYZ',
      '--rpc-url', 'https://soroban-testnet.stellar.org',
      '--network-passphrase', 'Test SDF Network ; September 2015',
      '--secret-key', 'SBXXXXXXXX',
    ]);

    expect(result.addressesPath).toBe('/path/to/addresses.json');
    expect(result.dryRun).toBe(true);
    expect(result.contractId).toBe('CBSXYZ');
    expect(result.rpcUrl).toBe('https://soroban-testnet.stellar.org');
    expect(result.networkPassphrase).toBe('Test SDF Network ; September 2015');
    expect(result.secretKey).toBe('SBXXXXXXXX');
  });

  it('handles --help flag', () => {
    const result = parseArgs(['--help']);
    expect(result.help).toBe(true);
  });

  it('handles -h flag as alias for --help', () => {
    const result = parseArgs(['-h']);
    expect(result.help).toBe(true);
  });

  it('ignores unknown flags', () => {
    const result = parseArgs([
      '--addresses', '/path/to/addresses.json',
      '--unknown-flag', 'value',
      '--dry-run',
    ]);

    expect(result.addressesPath).toBe('/path/to/addresses.json');
    expect(result.dryRun).toBe(true);
  });

  it('defaults dryRun to false when not specified', () => {
    const result = parseArgs(['--addresses', '/path/to/addresses.json']);
    expect(result.dryRun).toBe(false);
  });
});

describe('runCli', () => {
  let originalExit: NodeJS.Process['exitCode'];
  let originalConsoleError: typeof console.error;
  let originalConsoleLog: typeof console.log;
  let consoleLogs: string[] = [];
  let consoleErrors: string[] = [];

  beforeEach(() => {
    originalExit = process.exitCode;
    process.exitCode = undefined;
    originalConsoleError = console.error;
    originalConsoleLog = console.log;
    consoleLogs = [];
    consoleErrors = [];
    console.error = jest.fn((msg) => {
      consoleErrors.push(msg);
    });
    console.log = jest.fn((msg) => {
      consoleLogs.push(msg);
    });
  });

  afterEach(() => {
    process.exitCode = originalExit;
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
  });

  it('shows help when --help flag is passed', async () => {
    await runCli(['--help']);
    const output = consoleLogs.join('\n');
    expect(output).toContain('sanctions-oracle sync');
    expect(output).toContain('--addresses');
    expect(output).toContain('--dry-run');
    expect(output).toContain('--contract-id');
  });

  it('dry-run mode: runs without calling writer.addToDenylist', async () => {
    const addressesFile = '/tmp/test-addresses.json';
    const addresses = [Object.keys(MOCK_FLAGGED_ADDRESSES)[0], 'GCLEAN'];
    fs.writeFileSync(addressesFile, JSON.stringify(addresses));

    await runCli(['--addresses', addressesFile, '--dry-run']);

    const jsonLog = consoleLogs.find((log) => log.startsWith('{'));
    expect(jsonLog).toBeDefined();
    const result = JSON.parse(jsonLog!);
    expect(result.dryRun).toBe(true);
    expect(result.flagged.length).toBeGreaterThan(0);
    expect(result.written).toEqual([]);

    fs.unlinkSync(addressesFile);
  });

  it('exits with code 1 when --addresses flag is missing', async () => {
    await runCli(['--dry-run']);
    expect(process.exitCode).toBe(1);
    const output = consoleErrors.join('\n');
    expect(output).toContain('Missing required flag: --addresses');
  });

  it('exits with code 1 when live sync is missing required flags', async () => {
    const addressesFile = '/tmp/test-addresses.json';
    fs.writeFileSync(addressesFile, JSON.stringify(['GTEST']));

    await runCli(['--addresses', addressesFile]);

    expect(process.exitCode).toBe(1);
    const output = consoleErrors.join('\n');
    expect(output).toContain('Missing required flags for a live sync');

    fs.unlinkSync(addressesFile);
  });
});
