import { expectType, expectAssignable, expectError } from 'tsd';
import {
  SanctionsOracle,
  SanctionsOracleOptions,
  SanctionsResult,
  SanctionsMatch,
  SanctionsList,
  SanctionsListType,
  SanctionsCheckOptions,
  createSanctionsOracle,
  checkSanctions,
  isSanctioned,
  loadSanctionsList,
  parseSanctionsList,
  SanctionsError,
  SanctionsListError,
  SanctionsTimeoutError,
} from '../src/index';

// ---------------------------------------------------------------------------
// SanctionsOracle class
// ---------------------------------------------------------------------------

const oracle = new SanctionsOracle();

expectType<SanctionsOracle>(oracle);

const oracleWithOptions = new SanctionsOracle({
  lists: ['ofac', 'un'],
  timeout: 5000,
  cache: true,
});

expectType<SanctionsOracle>(oracleWithOptions);

expectAssignable<SanctionsOracleOptions>({});
expectAssignable<SanctionsOracleOptions>({ lists: ['ofac'] });
expectAssignable<SanctionsOracleOptions>({ timeout: 1000, cache: false });

// Constructor rejects invalid option shapes.
expectError(new SanctionsOracle({ lists: 'ofac' }));
expectError(new SanctionsOracle({ timeout: 'fast' }));

// check returns a Promise<SanctionsResult>
expectType<Promise<SanctionsResult>>(oracle.check('0xabc'));
expectType<Promise<SanctionsResult>>(oracle.check('0xabc', { lists: ['ofac'] }));

// isSanctioned returns a Promise<boolean>
expectType<Promise<boolean>>(oracle.isSanctioned('0xabc'));

// loadList returns a Promise<SanctionsList>
expectType<Promise<SanctionsList>>(oracle.loadList('ofac'));

// getMatches returns a Promise<SanctionsMatch[]>
expectType<Promise<SanctionsMatch[]>>(oracle.getMatches('0xabc'));

// ---------------------------------------------------------------------------
// SanctionsResult shape
// ---------------------------------------------------------------------------

const result = await oracle.check('0xabc');

expectType<boolean>(result.sanctioned);
expectType<SanctionsMatch[]>(result.matches);
expectType<string>(result.address);
expectType<number>(result.checkedAt);

expectAssignable<SanctionsResult>({
  address: '0xabc',
  sanctioned: false,
  matches: [],
  checkedAt: Date.now(),
});

// ---------------------------------------------------------------------------
// SanctionsMatch shape
// ---------------------------------------------------------------------------

const match = result.matches[0];

if (match) {
  expectType<string>(match.address);
  expectType<SanctionsListType>(match.list);
  expectType<string>(match.name);
  expectType<number>(match.score);
}

expectAssignable<SanctionsMatch>({
  address: '0xabc',
  list: 'ofac',
  name: 'Test Entity',
  score: 1,
});

// ---------------------------------------------------------------------------
// SanctionsList shape
// ---------------------------------------------------------------------------

const list = await oracle.loadList('ofac');

expectType<SanctionsListType>(list.type);
expectType<string>(list.name);
expectType<SanctionsMatch[]>(list.entries);
expectType<number>(list.updatedAt);

// ---------------------------------------------------------------------------
// SanctionsListType union
// ---------------------------------------------------------------------------

expectAssignable<SanctionsListType>('ofac');
expectAssignable<SanctionsListType>('un');
expectAssignable<SanctionsListType>('eu');
expectError<SanctionsListType>('unknown-list');

// ---------------------------------------------------------------------------
// SanctionsCheckOptions
// ---------------------------------------------------------------------------

expectAssignable<SanctionsCheckOptions>({});
expectAssignable<SanctionsCheckOptions>({ lists: ['ofac'] });
expectAssignable<SanctionsCheckOptions>({ lists: ['ofac', 'un'], threshold: 0.8 });
expectError<SanctionsCheckOptions>({ lists: 'ofac' });
expectError<SanctionsCheckOptions>({ threshold: 'high' });

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

expectType<SanctionsOracle>(createSanctionsOracle());
expectType<SanctionsOracle>(createSanctionsOracle({ lists: ['ofac'] }));
expectError(createSanctionsOracle({ lists: 'ofac' }));

// ---------------------------------------------------------------------------
// Standalone functions
// ---------------------------------------------------------------------------

expectType<Promise<SanctionsResult>>(checkSanctions('0xabc'));
expectType<Promise<SanctionsResult>>(checkSanctions('0xabc', { lists: ['ofac'] }));
expectError(checkSanctions(123));

expectType<Promise<boolean>>(isSanctioned('0xabc'));
expectType<Promise<boolean>>(isSanctioned('0xabc', { lists: ['un'] }));
expectError(isSanctioned(123));

expectType<Promise<SanctionsList>>(loadSanctionsList('ofac'));
expectError(loadSanctionsList('unknown-list'));

// ---------------------------------------------------------------------------
// parseSanctionsList generic inference
// ---------------------------------------------------------------------------

const rawEntries = [{ address: '0xabc', name: 'Test' }];

const parsed = parseSanctionsList(rawEntries, 'ofac');

expectType<SanctionsList>(parsed);
expectType<SanctionsListType>(parsed.type);
expectType<SanctionsMatch[]>(parsed.entries);

// Generic parameter is inferred from the list type argument.
const parsedUn = parseSanctionsList(rawEntries, 'un');
expectType<SanctionsList>(parsedUn);

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

const baseError = new SanctionsError('boom');

expectType<SanctionsError>(baseError);
expectType<string>(baseError.message);
expectAssignable<Error>(baseError);

const listError = new SanctionsListError('ofac', 'failed to load');

expectType<SanctionsListError>(listError);
expectType<SanctionsListType>(listError.list);
expectAssignable<SanctionsError>(listError);
expectAssignable<Error>(listError);

const timeoutError = new SanctionsTimeoutError(5000);

expectType<SanctionsTimeoutError>(timeoutError);
expectType<number>(timeoutError.timeout);
expectAssignable<SanctionsError>(timeoutError);
expectAssignable<Error>(timeoutError);