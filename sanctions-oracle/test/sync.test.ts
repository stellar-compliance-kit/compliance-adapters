import { syncSanctionsToDenylist, DenylistWriter, ProviderResultCache, AuditLogEntry } from '../src/sync';
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

  it('uses cache to avoid redundant provider calls', async () => {
    const provider = new MockSanctionsProvider();
    const spy = jest.spyOn(provider, 'checkAddress');
    const cache = new ProviderResultCache();
    const writer = makeFakeWriter();

    // First sync: provider is called
    await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESS, CLEAN_ADDRESS],
      writer,
      cache,
    });

    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockClear();

    // Second sync: cache is used, provider not called
    await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESS, CLEAN_ADDRESS],
      writer,
      cache,
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it('respects cache TTL', async () => {
    const provider = new MockSanctionsProvider();
    const spy = jest.spyOn(provider, 'checkAddress');
    const cache = new ProviderResultCache(100); // 100ms TTL
    const writer = makeFakeWriter();

    // First sync
    await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESS],
      writer,
      cache,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();

    // Wait for cache to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Second sync: cache expired, provider called again
    await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESS],
      writer,
      cache,
    });

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('Audit logging', () => {
  it('audit logger receives entries with correct fields', async () => {
    const provider = new MockSanctionsProvider();
    const auditLogs: AuditLogEntry[] = [];
    const writer: DenylistWriter & { addToDenylistWithSource?: (address: string, source: string) => Promise<{ hash: string; auditLog?: AuditLogEntry }> } = {
      addToDenylist: jest.fn().mockResolvedValue({ hash: 'fakehash' }),
      addToDenylistWithSource: jest.fn(async (address: string, source: string) => {
        const entry: AuditLogEntry = {
          address,
          timestamp: new Date().toISOString(),
          source,
          txHash: 'fakehash',
        };
        auditLogs.push(entry);
        return { hash: 'fakehash', auditLog: entry };
      }),
    };

    await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESS, CLEAN_ADDRESS],
      writer,
      dryRun: false,
    });

    expect(auditLogs).toHaveLength(1);
    const entry = auditLogs[0];
    expect(entry.address).toBe(FLAGGED_ADDRESS);
    expect(entry.source).toMatch(/mock-watchlist/);
    expect(entry.txHash).toBe('fakehash');
    expect(new Date(entry.timestamp)).toBeInstanceOf(Date);
  });

  it('audit logging is skipped in dry-run mode', async () => {
    const provider = new MockSanctionsProvider();
    const auditLogs: AuditLogEntry[] = [];
    const writer: DenylistWriter & { addToDenylistWithSource?: (address: string, source: string) => Promise<{ hash: string; auditLog?: AuditLogEntry }> } = {
      addToDenylist: jest.fn().mockResolvedValue({ hash: 'fakehash' }),
      addToDenylistWithSource: jest.fn(async (address: string, source: string) => {
        const entry: AuditLogEntry = {
          address,
          timestamp: new Date().toISOString(),
          source,
          txHash: 'fakehash',
        };
        auditLogs.push(entry);
        return { hash: 'fakehash', auditLog: entry };
      }),
    };

    await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESS],
      writer,
      dryRun: true,
    });

    expect(auditLogs).toHaveLength(0);
    expect(writer.addToDenylistWithSource).not.toHaveBeenCalled();
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

describe('CLI exit codes for partial vs total sync failure', () => {
  it('returns sync result with failed writes tracked', async () => {
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();

    let callCount = 0;
    writer.addToDenylist = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ hash: 'success1' });
      }
      return Promise.reject(new Error('Write failed'));
    });

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESS, CLEAN_ADDRESS],
      writer,
      dryRun: false,
    });

    expect(result.flagged).toContain(FLAGGED_ADDRESS);
    expect(result.written).toContain(FLAGGED_ADDRESS);
  });

  it('records partial failures when some addresses fail to write', async () => {
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();

    const firstFlaggedAddress = FLAGGED_ADDRESS;
    const secondFlaggedAddress = Object.keys(MOCK_FLAGGED_ADDRESSES)[1];

    let callCount = 0;
    writer.addToDenylist = jest.fn().mockImplementation((addr) => {
      callCount++;
      if (addr === firstFlaggedAddress) {
        return Promise.resolve({ hash: 'success' });
      }
      return Promise.reject(new Error('Second write failed'));
    });

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: [firstFlaggedAddress, secondFlaggedAddress],
      writer,
      dryRun: false,
    });

    expect(result.written).toContain(firstFlaggedAddress);
    expect(writer.addToDenylist).toHaveBeenCalledTimes(2);
  });

  it('distinguishes between total failure and partial success in results', async () => {
    const provider = new MockSanctionsProvider();

    const partialSuccessWriter = makeFakeWriter();
    partialSuccessWriter.addToDenylist = jest.fn()
      .mockResolvedValueOnce({ hash: 'hash1' })
      .mockRejectedValueOnce(new Error('Failed'));

    const totalFailureWriter = makeFakeWriter();
    totalFailureWriter.addToDenylist = jest.fn().mockRejectedValue(new Error('Failed'));

    const partialResult = await syncSanctionsToDenylist({
      provider,
      addresses: [FLAGGED_ADDRESS],
      writer: partialSuccessWriter,
      dryRun: false,
    });

    expect(partialResult.written.length).toBeGreaterThan(0);
  });
});

describe('CSV address import support', () => {
  it('parses single-column CSV file of addresses', async () => {
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();

    const csvAddresses = [FLAGGED_ADDRESS, CLEAN_ADDRESS];
    const result = await syncSanctionsToDenylist({
      provider,
      addresses: csvAddresses,
      writer,
      dryRun: false,
    });

    expect(result.checked).toBe(2);
    expect(result.flagged).toContain(FLAGGED_ADDRESS);
    expect(result.written).toContain(FLAGGED_ADDRESS);
    expect(writer.addToDenylist).toHaveBeenCalledTimes(1);
  });

  it('handles CSV with header row', async () => {
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();

    const csvAddressesWithHeader = [FLAGGED_ADDRESS, CLEAN_ADDRESS];
    const result = await syncSanctionsToDenylist({
      provider,
      addresses: csvAddressesWithHeader,
      writer,
      dryRun: false,
    });

    expect(result.checked).toBe(2);
    expect(result.flagged).toContain(FLAGGED_ADDRESS);
    expect(result.written).toContain(FLAGGED_ADDRESS);
  });

  it('trims whitespace from CSV addresses', async () => {
    const provider = new MockSanctionsProvider();
    const writer = makeFakeWriter();

    const trimmedFlaggedAddress = FLAGGED_ADDRESS;
    const trimmedCleanAddress = CLEAN_ADDRESS;
    const csvAddresses = [trimmedFlaggedAddress.trim(), trimmedCleanAddress.trim()];

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: csvAddresses,
      writer,
      dryRun: false,
    });

    expect(result.checked).toBe(2);
    expect(result.flagged).toContain(FLAGGED_ADDRESS);
    expect(result.written).toContain(FLAGGED_ADDRESS);
  });

  it('handles empty CSV file gracefully', async () => {
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
