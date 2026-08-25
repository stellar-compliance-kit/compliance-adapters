import { Account, Keypair } from '@stellar/stellar-sdk';

const mockGetAccount = jest.fn();
const mockPrepareTransaction = jest.fn();
const mockSendTransaction = jest.fn();

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: jest.fn().mockImplementation(() => ({
        getAccount: mockGetAccount,
        prepareTransaction: mockPrepareTransaction,
        sendTransaction: mockSendTransaction,
      })),
    },
  };
});

// Imported after the mock so `createRpcDenylistWriter` picks up the mocked rpc.Server.
import { createRpcDenylistWriter } from '../src/sync';

const SOURCE_KEYPAIR = Keypair.random();
const TARGET_ADDRESS = Keypair.random().publicKey();

describe('createRpcDenylistWriter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAccount.mockResolvedValue(new Account(SOURCE_KEYPAIR.publicKey(), '1'));
    // The mock stands in for simulation; hand back the built (unsigned) tx unchanged.
    mockPrepareTransaction.mockImplementation(async (tx) => tx);
  });

  function makeWriter(overrides: Partial<Parameters<typeof createRpcDenylistWriter>[0]> = {}) {
    return createRpcDenylistWriter({
      rpcUrl: 'http://localhost:8000',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
      sourceKeypair: SOURCE_KEYPAIR,
      maxRetries: 3,
      backoffOptions: { baseMs: 1, maxMs: 1, jitter: false },
      ...overrides,
    });
  }

  describe('addToDenylist', () => {
    it('retries sendTransaction on transient failure and eventually succeeds', async () => {
      mockSendTransaction
        .mockRejectedValueOnce(new Error('rpc timeout'))
        .mockResolvedValueOnce({ hash: 'txhash-1' });

      const writer = makeWriter();
      const result = await writer.addToDenylist(TARGET_ADDRESS);

      expect(result).toEqual({ hash: 'txhash-1' });
      expect(mockSendTransaction).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting all retry attempts', async () => {
      mockSendTransaction.mockRejectedValue(new Error('rpc down'));

      const writer = makeWriter({ maxRetries: 2 });
      await expect(writer.addToDenylist(TARGET_ADDRESS)).rejects.toThrow(
        /Failed to send transaction after 2 attempts/,
      );
      expect(mockSendTransaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('addToDenylistWithSource', () => {
    it('retries sendTransaction on transient failure just like addToDenylist', async () => {
      mockSendTransaction
        .mockRejectedValueOnce(new Error('rpc timeout'))
        .mockResolvedValueOnce({ hash: 'txhash-2' });

      const auditLogger = jest.fn();
      const writer = makeWriter({ auditLogger });

      const result = await writer.addToDenylistWithSource!(TARGET_ADDRESS, 'OFAC-SDN');

      expect(result.hash).toBe('txhash-2');
      expect(mockSendTransaction).toHaveBeenCalledTimes(2);
      expect(auditLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          address: TARGET_ADDRESS,
          source: 'OFAC-SDN',
          txHash: 'txhash-2',
        }),
      );
    });

    it('throws after exhausting all retry attempts and never invokes the audit logger', async () => {
      mockSendTransaction.mockRejectedValue(new Error('rpc down'));

      const auditLogger = jest.fn();
      const writer = makeWriter({ maxRetries: 2, auditLogger });

      await expect(writer.addToDenylistWithSource!(TARGET_ADDRESS, 'OFAC-SDN')).rejects.toThrow(
        /Failed to send transaction after 2 attempts/,
      );
      expect(mockSendTransaction).toHaveBeenCalledTimes(2);
      expect(auditLogger).not.toHaveBeenCalled();
    });
  });
});
