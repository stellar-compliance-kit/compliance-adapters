import { syncSanctionsToDenylist, DenylistWriter, ProviderResultCache, AuditLogEntry } from '../src/sync';
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
