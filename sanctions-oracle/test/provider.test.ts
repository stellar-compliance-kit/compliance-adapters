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
    const result = await provider.checkAddress('GHBRPOIGF3CBFNOBM2O4RAK3VRJNVGFYGWWQC5HYFSXMECOSFOGYR5XK');
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
      'CSV file not found at path: /nonexistent/path.csv'
    );
  });
});
