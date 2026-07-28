import { syncSanctionsToDenylist, DenylistWriter } from '../src/sync';
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
});

describe('stdin address reading support', () => {
  it('parses addresses from stdin when --addresses - is passed', async () => {
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();

    const stdinAddresses = [FLAGGED_ADDRESS, CLEAN_ADDRESS];
    const result = await syncSanctionsToDenylist({
      provider,
      addresses: stdinAddresses,
      writer,
      dryRun: false,
    });

    expect(result.checked).toBe(2);
    expect(result.flagged).toContain(FLAGGED_ADDRESS);
    expect(result.written).toContain(FLAGGED_ADDRESS);
  });

  it('handles empty JSON array from stdin', async () => {
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: [],
      writer,
      dryRun: false,
    });

    expect(result.checked).toBe(0);
    expect(result.flagged).toEqual([]);
    expect(result.written).toEqual([]);
    expect(writer.addToDenylist).not.toHaveBeenCalled();
  });
});

describe('diff-mode: only write newly-flagged addresses', () => {
  it('only writes addresses not already in the current denylist', async () => {
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();

    const currentDenylist = [FLAGGED_ADDRESS];
    const allAddresses = [FLAGGED_ADDRESS, CLEAN_ADDRESS];

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: allAddresses,
      writer,
      dryRun: false,
      currentDenylist,
    });

    expect(result.checked).toBe(2);
    expect(result.flagged).toEqual([FLAGGED_ADDRESS]);
    expect(result.written).toEqual([]);
    expect(writer.addToDenylist).not.toHaveBeenCalled();
  });

  it('writes flagged addresses not in the current denylist', async () => {
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();

    const secondFlaggedAddress = Object.keys(MOCK_FLAGGED_ADDRESSES)[1];
    const currentDenylist = [FLAGGED_ADDRESS];
    const allAddresses = [FLAGGED_ADDRESS, secondFlaggedAddress, CLEAN_ADDRESS];

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: allAddresses,
      writer,
      dryRun: false,
      currentDenylist,
    });

    expect(result.checked).toBe(3);
    expect(result.flagged).toContain(FLAGGED_ADDRESS);
    expect(result.flagged).toContain(secondFlaggedAddress);
    expect(result.written).toEqual([secondFlaggedAddress]);
    expect(writer.addToDenylist).toHaveBeenCalledTimes(1);
    expect(writer.addToDenylist).toHaveBeenCalledWith(secondFlaggedAddress);
  });

  it('handles empty current denylist by writing all flagged addresses', async () => {
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESS, CLEAN_ADDRESS],
      writer,
      dryRun: false,
      currentDenylist: [],
    });

    expect(result.written).toEqual([FLAGGED_ADDRESS]);
    expect(writer.addToDenylist).toHaveBeenCalledTimes(1);
  });
});
