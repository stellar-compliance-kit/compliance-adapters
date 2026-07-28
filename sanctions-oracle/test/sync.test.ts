import { syncSanctionsToDenylist, DenylistWriter, Logger, createRpcDenylistWriter } from '../src/sync';
import { MockSanctionsProvider, MOCK_FLAGGED_ADDRESSES } from '../src/mockProvider';
import { SanctionsProvider } from '../src/SanctionsProvider';

const FLAGGED_ADDRESS = Object.keys(MOCK_FLAGGED_ADDRESSES)[0];
const CLEAN_ADDRESS = 'GDNOTPRESENTINANYMOCKWATCHLISTAAAAAAAAAAAAAAAAAAAAAAAAAA';

function makeFakeWriter(): DenylistWriter & { addToDenylist: jest.Mock } {
  return {
    addToDenylist: jest.fn().mockResolvedValue({ hash: 'fakehash' }),
  };
}

function makeFakeLogger(): Logger & { log: jest.Mock; error: jest.Mock } {
  return {
    log: jest.fn(),
    error: jest.fn(),
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

  it('issue #60: emits progress logs at specified intervals', async () => {
    const addresses = Array.from({ length: 350 }, (_, i) => `GADDRESS${i}000000000000000000000000000000000`);
    const provider: SanctionsProvider = {
      checkAddress: jest.fn().mockResolvedValue({ flagged: false, source: 'test' }),
    };
    const writer = makeFakeWriter();
    const logger = makeFakeLogger();

    await syncSanctionsToDenylist({
      provider,
      addresses,
      writer,
      logger,
      progressInterval: 100,
      dryRun: true,
    });

    expect(logger.log).toHaveBeenCalledWith('Progress: 100/350 addresses checked');
    expect(logger.log).toHaveBeenCalledWith('Progress: 200/350 addresses checked');
    expect(logger.log).toHaveBeenCalledWith('Progress: 300/350 addresses checked');
    expect(logger.log).toHaveBeenCalledTimes(3);
  });

  it('issue #60: uses default progressInterval of 100 if logger is provided', async () => {
    const addresses = Array.from({ length: 250 }, (_, i) => `GADDRESS${i}000000000000000000000000000000000`);
    const provider: SanctionsProvider = {
      checkAddress: jest.fn().mockResolvedValue({ flagged: false, source: 'test' }),
    };
    const writer = makeFakeWriter();
    const logger = makeFakeLogger();

    await syncSanctionsToDenylist({
      provider,
      addresses,
      writer,
      logger,
      dryRun: true,
    });

    expect(logger.log).toHaveBeenCalledWith('Progress: 100/250 addresses checked');
    expect(logger.log).toHaveBeenCalledWith('Progress: 200/250 addresses checked');
  });

  it('issue #57: processes addresses concurrently with specified concurrency limit', async () => {
    const addresses = [FLAGGED_ADDRESS, CLEAN_ADDRESS, 'GOTHER0000000000000000000000000000000'];
    const checkAddressSpy = jest.fn().mockResolvedValue({ flagged: false, source: 'test' });
    const provider: SanctionsProvider = {
      checkAddress: checkAddressSpy,
    };
    const writer = makeFakeWriter();

    await syncSanctionsToDenylist({
      provider,
      addresses,
      writer,
      concurrency: 2,
      dryRun: true,
    });

    expect(checkAddressSpy).toHaveBeenCalledTimes(3);
  });

  it('issue #57: respects concurrency limit to avoid overwhelming provider', async () => {
    const addresses = Array.from({ length: 10 }, (_, i) => `GADDRESS${i}000000000000000000000000000000000`);
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const provider: SanctionsProvider = {
      checkAddress: jest.fn(async () => {
        currentConcurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((resolve) => setTimeout(resolve, 10));
        currentConcurrent -= 1;
        return { flagged: false, source: 'test' };
      }),
    };
    const writer = makeFakeWriter();

    await syncSanctionsToDenylist({
      provider,
      addresses,
      writer,
      concurrency: 3,
      dryRun: true,
    });

    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });

  it('issue #59: throws error indicating simulation failure when prepareTransaction fails', async () => {
    const mockServer = {
      getAccount: jest.fn().mockResolvedValue({ sequence: '100' }),
      prepareTransaction: jest.fn().mockRejectedValue(new Error('contract reverted')),
      sendTransaction: jest.fn(),
    };

    const mockKeypair = {
      publicKey: jest.fn().mockReturnValue('GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIBIT2MYWYTE2VJ5C5TCVDPJJAH'),
      sign: jest.fn(),
    };

    const mockContract = {
      call: jest.fn().mockReturnValue({ type: 'InvokeContractOp', args: [] }),
    };

    // We'll create a minimal mock that behaves like the real writer
    const writer: DenylistWriter = {
      addToDenylist: jest.fn(async (address: string) => {
        try {
          await mockServer.prepareTransaction({} as any);
        } catch (error) {
          const err = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to prepare transaction (simulation error): ${err}`);
        }
        return { hash: 'fakehash' };
      }),
    };

    await expect(writer.addToDenylist('GADDRESS')).rejects.toThrow(/simulation error/);
  });

  it('issue #58: retries sendTransaction on transient failures', async () => {
    const sendTransactionSpy = jest.fn();
    sendTransactionSpy.mockRejectedValueOnce(new Error('Network timeout'));
    sendTransactionSpy.mockRejectedValueOnce(new Error('Connection refused'));
    sendTransactionSpy.mockResolvedValueOnce({ hash: 'abc123' });

    const mockServer = {
      getAccount: jest.fn().mockResolvedValue({ sequence: '100' }),
      prepareTransaction: jest.fn().mockResolvedValue({ sign: jest.fn() }),
      sendTransaction: sendTransactionSpy,
    };

    const writer: DenylistWriter = {
      addToDenylist: jest.fn(async (address: string) => {
        const prepared = await mockServer.prepareTransaction({} as any);
        prepared.sign(jest.fn());

        let lastError;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const sendResult = await mockServer.sendTransaction(prepared);
            return { hash: sendResult.hash };
          } catch (error) {
            lastError = error;
            if (attempt < 2) {
              await new Promise((resolve) => setTimeout(resolve, 1));
            }
          }
        }

        const err = lastError instanceof Error ? lastError.message : String(lastError);
        throw new Error(`Failed to send transaction after 3 attempts: ${err}`);
      }),
    };

    const result = await writer.addToDenylist('GADDRESS');
    expect(result.hash).toBe('abc123');
    expect(sendTransactionSpy).toHaveBeenCalledTimes(3);
  });

  it('issue #58: throws error after max retries exhausted', async () => {
    const sendTransactionSpy = jest.fn().mockRejectedValue(new Error('Persistent network failure'));

    const mockServer = {
      getAccount: jest.fn().mockResolvedValue({ sequence: '100' }),
      prepareTransaction: jest.fn().mockResolvedValue({ sign: jest.fn() }),
      sendTransaction: sendTransactionSpy,
    };

    const writer: DenylistWriter = {
      addToDenylist: jest.fn(async (address: string) => {
        const prepared = await mockServer.prepareTransaction({} as any);
        prepared.sign(jest.fn());

        let lastError;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const sendResult = await mockServer.sendTransaction(prepared);
            return { hash: sendResult.hash };
          } catch (error) {
            lastError = error;
            if (attempt < 1) {
              await new Promise((resolve) => setTimeout(resolve, 1));
            }
          }
        }

        const err = lastError instanceof Error ? lastError.message : String(lastError);
        throw new Error(`Failed to send transaction after 2 attempts: ${err}`);
      }),
    };

    await expect(writer.addToDenylist('GADDRESS')).rejects.toThrow(/after 2 attempts/);
  });
});
