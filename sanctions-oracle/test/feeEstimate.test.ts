import { syncSanctionsToDenylist, DenylistWriter } from '../src/sync';
import { MockSanctionsProvider, MOCK_FLAGGED_ADDRESSES } from '../src/mockProvider';

const FLAGGED = Object.keys(MOCK_FLAGGED_ADDRESSES);

function writer(): DenylistWriter {
  return { addToDenylist: jest.fn().mockResolvedValue({ hash: 'fakehash' }) };
}

describe('dry-run fee estimate summary', () => {
  it('sums an individual estimate for every pending write', async () => {
    const provider = new MockSanctionsProvider();
    const feeEstimator = jest
      .fn()
      .mockResolvedValueOnce(100n)
      .mockResolvedValueOnce(250n)
      .mockResolvedValueOnce('75');

    const result = await syncSanctionsToDenylist({
      provider,
      addresses: [...FLAGGED.slice(0, 3), 'GDNOTPRESENTINANYMOCKWATCHLISTAAAAAAAAAAAAAAAAAAAAAAAAAA'],
      writer: writer(),
      dryRun: true,
      feeEstimator,
    });

    expect(feeEstimator).toHaveBeenCalledTimes(3);
    expect(result.feeEstimate).toMatchObject({
      pendingWrites: 3,
      perWriteFeesStroops: ['100', '250', '75'],
      perTxFeeStroops: '100',
      totalFeeStroops: '425',
      totalFeeXlm: '0.0000425',
    });
  });

  it('reports a zero total when there are no pending writes', async () => {
    const result = await syncSanctionsToDenylist({
      provider: new MockSanctionsProvider(),
      addresses: [],
      writer: writer(),
      dryRun: true,
      feeEstimator: jest.fn(),
    });

    expect(result.feeEstimate).toMatchObject({
      pendingWrites: 0,
      totalFeeStroops: '0',
      totalFeeXlm: '0.0000000',
    });
  });

  it('reports estimator errors without failing the dry run', async () => {
    const result = await syncSanctionsToDenylist({
      provider: new MockSanctionsProvider(),
      addresses: FLAGGED.slice(0, 1),
      writer: writer(),
      dryRun: true,
      feeEstimator: jest.fn().mockRejectedValue(new Error('simulation unavailable')),
    });

    expect(result.feeEstimate?.error).toContain('simulation unavailable');
    expect(result.dryRun).toBe(true);
  });
});
