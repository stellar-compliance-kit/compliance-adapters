import { syncSanctionsToDenylist, DenylistWriter } from '../src/sync';
import { SanctionsProvider } from '../src/SanctionsProvider';
import { MockSanctionsProvider, MOCK_FLAGGED_ADDRESSES } from '../src/mockProvider';

const FLAGGED_ADDRESS = Object.keys(MOCK_FLAGGED_ADDRESSES)[0];
const CLEAN_ADDRESS = 'GDNOTPRESENTINANYMOCKWATCHLISTAAAAAAAAAAAAAAAAAAAAAAAAAA';
const instantSleep = async (): Promise<void> => {};

function makeFakeWriter(): DenylistWriter & { addToDenylist: jest.Mock } {
  return {
    addToDenylist: jest.fn().mockResolvedValue({ hash: 'fakehash' }),
  };
}

function makeFlakyProvider(failuresBeforeSuccess: number): SanctionsProvider {
  let calls = 0;
  return {
    async checkAddress(address: string) {
      calls += 1;
      if (calls <= failuresBeforeSuccess) {
        throw new Error(`transient failure ${calls}`);
      }
      return { flagged: address === FLAGGED_ADDRESS, source: 'flaky-provider' };
    },
  };
}

function makeAlwaysFailingProvider(): SanctionsProvider {
  return {
    async checkAddress(): Promise<{ flagged: boolean; source: string }> {
      throw new Error('provider unavailable');
    },
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

  it('retries a provider call that fails then succeeds, and still reflects the result correctly', async () => {
    const provider = makeFlakyProvider(2);
    const writer = makeFakeWriter();

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESS],
      writer,
      dryRun: true,
      retry: { maxAttempts: 3, sleepFn: instantSleep },
    });

    expect(result.flagged).toEqual([FLAGGED_ADDRESS]);
    expect(result.failed).toEqual([]);
  });

  it('reports an address whose provider call exhausts all retries as failed, without crashing the sync', async () => {
    const provider = makeAlwaysFailingProvider();
    const writer = makeFakeWriter();

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESS, CLEAN_ADDRESS],
      writer,
      dryRun: true,
      retry: { maxAttempts: 2, sleepFn: instantSleep },
    });

    expect(result.checked).toBe(2);
    expect(result.flagged).toEqual([]);
    expect(result.failed).toEqual([FLAGGED_ADDRESS, CLEAN_ADDRESS]);
  });

  it('does not write a failed address to the denylist', async () => {
    const provider = makeAlwaysFailingProvider();
    const writer = makeFakeWriter();

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESS],
      writer,
      dryRun: false,
      retry: { maxAttempts: 1, sleepFn: instantSleep },
    });

    expect(writer.addToDenylist).not.toHaveBeenCalled();
    expect(result.written).toEqual([]);
    expect(result.failed).toEqual([FLAGGED_ADDRESS]);
  });

  it('handles empty address list correctly in dry-run mode', async () => {
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: [],
      writer,
      dryRun: true,
    });

    expect(writer.addToDenylist).not.toHaveBeenCalled();
    expect(result.checked).toBe(0);
    expect(result.flagged).toEqual([]);
    expect(result.written).toEqual([]);
  });

  it('handles empty address list correctly in live mode', async () => {
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: [],
      writer,
      dryRun: false,
    });

    expect(writer.addToDenylist).not.toHaveBeenCalled();
    expect(result.checked).toBe(0);
    expect(result.flagged).toEqual([]);
    expect(result.written).toEqual([]);
  });

  it('processes all flagged addresses when multiple are present', async () => {
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();
    const allFlaggedAddresses = Object.keys(MOCK_FLAGGED_ADDRESSES);

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: allFlaggedAddresses,
      writer,
      dryRun: false,
    });

    expect(writer.addToDenylist).toHaveBeenCalledTimes(allFlaggedAddresses.length);
    expect(result.checked).toBe(allFlaggedAddresses.length);
    expect(result.flagged).toEqual(allFlaggedAddresses);
    expect(result.written).toEqual(allFlaggedAddresses);
  });

  it('continues processing when writer rejects on one address', async () => {
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();
    writer.addToDenylist = jest
      .fn()
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce({ hash: 'hash2' });

    const allFlaggedAddresses = Object.keys(MOCK_FLAGGED_ADDRESSES);
    const twoAddresses = allFlaggedAddresses.slice(0, 2);

    await expect(
      syncSanctionsToDenylist({
        provider,
        addresses: twoAddresses,
        writer,
        dryRun: false,
      }),
    ).rejects.toThrow('write failed');

    expect(writer.addToDenylist).toHaveBeenCalledTimes(1);
  });

  it('returns correct statistics for mixed clean and flagged addresses', async () => {
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();
    const cleanAddresses = ['GCLEAN1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'GCLEAN2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'];
    const allAddresses = [FLAGGED_ADDRESS, ...cleanAddresses];

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: allAddresses,
      writer,
      dryRun: false,
    });

    expect(result.checked).toBe(3);
    expect(result.flagged).toHaveLength(1);
    expect(result.flagged).toContain(FLAGGED_ADDRESS);
  });

  it('dry-run identifies all flagged addresses without writing any', async () => {
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();
    const allFlaggedAddresses = Object.keys(MOCK_FLAGGED_ADDRESSES);

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: allFlaggedAddresses,
      writer,
      dryRun: true,
    });

    expect(result.flagged).toEqual(allFlaggedAddresses);
    expect(result.written).toEqual([]);
    expect(writer.addToDenylist).not.toHaveBeenCalled();
  });
});
