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
