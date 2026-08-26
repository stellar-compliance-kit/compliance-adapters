import { InMemoryRevocationStore } from '../src/revocation';

const ADDRESS = 'GDNOTPRESENTINANYMOCKWATCHLISTAAAAAAAAAAAAAAAAAAAAAAAAAA';

describe('InMemoryRevocationStore', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports an address as not revoked before any revoke() call', () => {
    const store = new InMemoryRevocationStore();
    expect(store.isRevoked(ADDRESS)).toBe(false);
  });

  it('permanently revokes an address when no `until` is given', () => {
    const store = new InMemoryRevocationStore();
    store.revoke(ADDRESS);
    expect(store.isRevoked(ADDRESS)).toBe(true);

    jest.setSystemTime(new Date('2099-01-01T00:00:00.000Z'));
    expect(store.isRevoked(ADDRESS)).toBe(true);
  });

  it('treats a revocation with a future `until` as revoked until that time passes', () => {
    const store = new InMemoryRevocationStore();
    store.revoke(ADDRESS, new Date('2026-01-01T00:10:00.000Z'));

    expect(store.isRevoked(ADDRESS)).toBe(true);

    jest.setSystemTime(new Date('2026-01-01T00:09:59.999Z'));
    expect(store.isRevoked(ADDRESS)).toBe(true);
  });

  it('treats a revocation with a past `until` as not revoked and self-cleans the entry', () => {
    const store = new InMemoryRevocationStore();
    store.revoke(ADDRESS, new Date('2025-12-31T23:59:59.000Z'));

    expect(store.isRevoked(ADDRESS)).toBe(false);
  });

  it('treats a revocation as expired the instant `until` is reached (<=, not <)', () => {
    const store = new InMemoryRevocationStore();
    const now = new Date('2026-01-01T00:00:00.000Z');
    store.revoke(ADDRESS, now);

    expect(store.isRevoked(ADDRESS)).toBe(false);
  });

  it('expires a temporary revocation once `until` passes on a later check', () => {
    const store = new InMemoryRevocationStore();
    store.revoke(ADDRESS, new Date('2026-01-01T00:00:30.000Z'));
    expect(store.isRevoked(ADDRESS)).toBe(true);

    jest.setSystemTime(new Date('2026-01-01T00:01:00.000Z'));
    expect(store.isRevoked(ADDRESS)).toBe(false);
  });

  it('unrevoke() lifts a permanent revocation', () => {
    const store = new InMemoryRevocationStore();
    store.revoke(ADDRESS);
    expect(store.isRevoked(ADDRESS)).toBe(true);

    store.unrevoke(ADDRESS);
    expect(store.isRevoked(ADDRESS)).toBe(false);
  });

  it('unrevoke() lifts a temporary revocation before it would have expired', () => {
    const store = new InMemoryRevocationStore();
    store.revoke(ADDRESS, new Date('2099-01-01T00:00:00.000Z'));
    expect(store.isRevoked(ADDRESS)).toBe(true);

    store.unrevoke(ADDRESS);
    expect(store.isRevoked(ADDRESS)).toBe(false);
  });

  it('unrevoke() on an address that was never revoked is a no-op', () => {
    const store = new InMemoryRevocationStore();
    expect(() => store.unrevoke(ADDRESS)).not.toThrow();
    expect(store.isRevoked(ADDRESS)).toBe(false);
  });

  it('tracks multiple addresses independently', () => {
    const store = new InMemoryRevocationStore();
    const otherAddress = 'GOTHERADDRESSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    store.revoke(ADDRESS);
    expect(store.isRevoked(ADDRESS)).toBe(true);
    expect(store.isRevoked(otherAddress)).toBe(false);
  });
});
