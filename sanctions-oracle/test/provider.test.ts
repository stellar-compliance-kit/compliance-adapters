import { SanctionsProvider } from '../src/SanctionsProvider';
import { MockSanctionsProvider, MOCK_FLAGGED_ADDRESSES } from '../src/mockProvider';
import { CsvSanctionsProvider } from '../src/csvProvider';
import * as path from 'path';
import { assertSanctionsProviderContract } from './providerContract';

const KNOWN_FLAGGED_ADDRESS = Object.keys(MOCK_FLAGGED_ADDRESSES)[0];
const KNOWN_UNFLAGGED_ADDRESS = 'GDNOTPRESENTINANYMOCKWATCHLISTAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('SanctionsProvider interface conformance', () => {
  it('MockSanctionsProvider conforms to the SanctionsProvider contract', async () => {
    const provider = new MockSanctionsProvider();
    await assertSanctionsProviderContract(provider);
  });

  it('CsvSanctionsProvider conforms to the SanctionsProvider shape', async () => {
    const csvPath = path.join(__dirname, 'fixtures', 'addresses.csv');
    await assertConformsToSanctionsProvider(new CsvSanctionsProvider(csvPath));
  });
});

describe('MockSanctionsProvider', () => {
  it('flags a known mock-watchlist address', async () => {
    const provider = new MockSanctionsProvider();
    const result = await provider.checkAddress(KNOWN_FLAGGED_ADDRESS);
    expect(result.flagged).toBe(true);
    expect(result.source).toBe(MOCK_FLAGGED_ADDRESSES[KNOWN_FLAGGED_ADDRESS]);
  });

  it('does not flag an address absent from the mock watchlist', async () => {
    const provider = new MockSanctionsProvider();
    const result = await provider.checkAddress(KNOWN_UNFLAGGED_ADDRESS);
    expect(result.flagged).toBe(false);
    expect(result.source).toBe('mock-watchlist-v1');
  });
});

describe('CsvSanctionsProvider', () => {
  const csvPath = path.join(__dirname, 'fixtures', 'addresses.csv');

  it('flags a known CSV watchlist address', async () => {
    const provider = new CsvSanctionsProvider(csvPath);
    const result = await provider.checkAddress(
      'GD7PQQDZ75ZIY3O3CZKO4P6NBRBDBYEM6PKROQUVKMXI6J2SAB4FWYAN',
    );
    expect(result.flagged).toBe(true);
    expect(result.source).toBe('csv-watchlist-v1');
  });

  it('does not flag an address absent from the CSV watchlist', async () => {
    const provider = new CsvSanctionsProvider(csvPath);
    const result = await provider.checkAddress(KNOWN_UNFLAGGED_ADDRESS);
    expect(result.flagged).toBe(false);
    expect(result.source).toBe('csv-watchlist-v1');
  });

  it('throws an error when CSV file does not exist', () => {
    expect(() => new CsvSanctionsProvider('/nonexistent/path.csv')).toThrow(
      'CSV file not found at path: /nonexistent/path.csv',
    );
  });

  it('skips a row whose address column is not a valid Stellar G... address, without stopping the load', async () => {
    // The fixture's last row ("NOT-A-VALID-STELLAR-ADDRESS") is malformed;
    // the rows before it must still load successfully.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const provider = new CsvSanctionsProvider(csvPath);

      const invalidResult = await provider.checkAddress('NOT-A-VALID-STELLAR-ADDRESS');
      expect(invalidResult.flagged).toBe(false);

      const validResult = await provider.checkAddress(
        'GCSNJ6SE42RKXVFLWHFWRZKAWOVSTVVTZ2HBM2JV45NY3GGMB6PJBMXX',
      );
      expect(validResult.flagged).toBe(true);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('NOT-A-VALID-STELLAR-ADDRESS'),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
