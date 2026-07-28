import { syncSanctionsToDenylist, DenylistWriter, parseArgs, CliArgs } from '../src/sync';
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

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESS, FLAGGED_ADDRESS, CLEAN_ADDRESS, FLAGGED_ADDRESS],
      writer,
      dryRun: false,
    });

    expect(provider.checkAddress).toHaveBeenCalledTimes(2);
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
