import { SanctionsProvider } from '../src/SanctionsProvider';
import { ProviderRegistry, ProviderRegistryAllProvidersFailedError } from '../src/ProviderRegistry';
import { syncSanctionsToDenylist, DenylistWriter } from '../src/sync';

const ADDRESS = 'GTESTADDRESSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function fakeProvider(flagged: boolean, source: string): SanctionsProvider {
  return {
    async checkAddress() {
      return { flagged, source };
    },
  };
}

function throwingProvider(message: string): SanctionsProvider {
  return {
    async checkAddress() {
      throw new Error(message);
    },
  };
}

describe('ProviderRegistry', () => {
  describe('agreement', () => {
    it('all providers flagged: reports flagged under every policy', async () => {
      for (const policy of ['any-flag-wins', 'majority-vote', 'priority-override'] as const) {
        const registry = new ProviderRegistry({ policy });
        registry.register('a', fakeProvider(true, 'list-a'));
        registry.register('b', fakeProvider(true, 'list-b'));

        const result = await registry.checkAddress(ADDRESS);
        expect(result.flagged).toBe(true);
      }
    });

    it('all providers clear: reports not flagged under every policy', async () => {
      for (const policy of ['any-flag-wins', 'majority-vote', 'priority-override'] as const) {
        const registry = new ProviderRegistry({ policy });
        registry.register('a', fakeProvider(false, 'list-a'));
        registry.register('b', fakeProvider(false, 'list-b'));

        const result = await registry.checkAddress(ADDRESS);
        expect(result.flagged).toBe(false);
      }
    });
  });

  describe('disagreement: any-flag-wins', () => {
    it('flags the address if a single provider flags it', async () => {
      const registry = new ProviderRegistry({ policy: 'any-flag-wins' });
      registry.register('clean-a', fakeProvider(false, 'list-a'));
      registry.register('flagger', fakeProvider(true, 'internal-denylist'));
      registry.register('clean-b', fakeProvider(false, 'list-b'));

      const detailed = await registry.checkAddressDetailed(ADDRESS);

      expect(detailed.flagged).toBe(true);
      expect(detailed.source).toBe('flagger:internal-denylist');
      expect(detailed.results).toHaveLength(3);
      expect(detailed.errors).toHaveLength(0);
    });
  });

  describe('disagreement: majority-vote', () => {
    it('flags when a strict majority flags', async () => {
      const registry = new ProviderRegistry({ policy: 'majority-vote' });
      registry.register('a', fakeProvider(true, 'list-a'));
      registry.register('b', fakeProvider(true, 'list-b'));
      registry.register('c', fakeProvider(false, 'list-c'));

      const result = await registry.checkAddress(ADDRESS);
      expect(result.flagged).toBe(true);
    });

    it('clears when a strict majority clears', async () => {
      const registry = new ProviderRegistry({ policy: 'majority-vote' });
      registry.register('a', fakeProvider(false, 'list-a'));
      registry.register('b', fakeProvider(false, 'list-b'));
      registry.register('c', fakeProvider(true, 'list-c'));

      const result = await registry.checkAddress(ADDRESS);
      expect(result.flagged).toBe(false);
    });

    it('breaks a tie using tieBreak: "flag" (default)', async () => {
      const registry = new ProviderRegistry({ policy: 'majority-vote' });
      registry.register('a', fakeProvider(true, 'list-a'));
      registry.register('b', fakeProvider(false, 'list-b'));

      const result = await registry.checkAddress(ADDRESS);
      expect(result.flagged).toBe(true);
    });

    it('breaks a tie using tieBreak: "clear" when configured', async () => {
      const registry = new ProviderRegistry({ policy: 'majority-vote', tieBreak: 'clear' });
      registry.register('a', fakeProvider(true, 'list-a'));
      registry.register('b', fakeProvider(false, 'list-b'));

      const result = await registry.checkAddress(ADDRESS);
      expect(result.flagged).toBe(false);
    });
  });

  describe('disagreement: priority-override', () => {
    it("the highest-priority (lowest number) provider's answer wins outright", async () => {
      const registry = new ProviderRegistry({ policy: 'priority-override' });
      registry.register('internal-denylist', fakeProvider(false, 'internal-v3'), {
        priority: 0,
      });
      registry.register('external-list', fakeProvider(true, 'sdn-list'), { priority: 1 });

      const detailed = await registry.checkAddressDetailed(ADDRESS);

      expect(detailed.flagged).toBe(false);
      expect(detailed.source).toBe('internal-denylist:internal-v3');
    });

    it('falls through to the next-highest priority if the top one errored', async () => {
      const registry = new ProviderRegistry({ policy: 'priority-override' });
      registry.register('internal-denylist', throwingProvider('upstream down'), {
        priority: 0,
      });
      registry.register('external-list', fakeProvider(true, 'sdn-list'), { priority: 1 });

      const detailed = await registry.checkAddressDetailed(ADDRESS);

      expect(detailed.flagged).toBe(true);
      expect(detailed.source).toBe('external-list:sdn-list');
      expect(detailed.errors).toEqual([{ name: 'internal-denylist', error: 'upstream down' }]);
    });

    it('providers registered without a priority sort after prioritized ones', async () => {
      const registry = new ProviderRegistry({ policy: 'priority-override' });
      registry.register('no-priority', fakeProvider(true, 'list-a'));
      registry.register('prioritized', fakeProvider(false, 'list-b'), { priority: 5 });

      const result = await registry.checkAddress(ADDRESS);
      expect(result.flagged).toBe(false);
    });

    it('when two providers share the same priority, registration order is the tiebreaker', async () => {
      const registry = new ProviderRegistry({ policy: 'priority-override' });
      registry.register('first-registered', fakeProvider(false, 'list-a'), { priority: 5 });
      registry.register('second-registered', fakeProvider(true, 'list-b'), { priority: 5 });

      const detailed = await registry.checkAddressDetailed(ADDRESS);

      expect(detailed.flagged).toBe(false);
      expect(detailed.source).toBe('first-registered:list-a');
    });

    it('when three providers have no explicit priority, registration order determines the winner', async () => {
      const registry = new ProviderRegistry({ policy: 'priority-override' });
      registry.register('first', fakeProvider(true, 'flagged-list'));
      registry.register('second', fakeProvider(false, 'clean-list'));
      registry.register('third', fakeProvider(true, 'another-flagged-list'));

      const detailed = await registry.checkAddressDetailed(ADDRESS);

      expect(detailed.flagged).toBe(true);
      expect(detailed.source).toBe('first:flagged-list');
    });

    it('when three providers have no explicit priority, changing registration order changes the winner', async () => {
      const registry = new ProviderRegistry({ policy: 'priority-override' });
      registry.register('second', fakeProvider(false, 'clean-list'));
      registry.register('first', fakeProvider(true, 'flagged-list'));
      registry.register('third', fakeProvider(true, 'another-flagged-list'));

      const detailed = await registry.checkAddressDetailed(ADDRESS);

      expect(detailed.flagged).toBe(false);
      expect(detailed.source).toBe('second:clean-list');
    });
  });

  describe('a provider that errors while others succeed', () => {
    it('excludes the errored provider from the vote by default (onProviderError: "ignore")', async () => {
      const registry = new ProviderRegistry({ policy: 'any-flag-wins' });
      registry.register('flaky', throwingProvider('timeout'));
      registry.register('clean', fakeProvider(false, 'list-a'));

      const detailed = await registry.checkAddressDetailed(ADDRESS);

      expect(detailed.flagged).toBe(false);
      expect(detailed.results).toEqual([{ name: 'clean', flagged: false, source: 'list-a' }]);
      expect(detailed.errors).toEqual([{ name: 'flaky', error: 'timeout' }]);
    });

    it('treats the errored provider as flagged when onProviderError: "flag"', async () => {
      const registry = new ProviderRegistry({
        policy: 'any-flag-wins',
        onProviderError: 'flag',
      });
      registry.register('flaky', throwingProvider('timeout'));
      registry.register('clean', fakeProvider(false, 'list-a'));

      const result = await registry.checkAddress(ADDRESS);
      expect(result.flagged).toBe(true);
    });

    it('throws ProviderRegistryAllProvidersFailedError when every provider errors', async () => {
      const registry = new ProviderRegistry({ policy: 'any-flag-wins' });
      registry.register('a', throwingProvider('boom-a'));
      registry.register('b', throwingProvider('boom-b'));

      await expect(registry.checkAddress(ADDRESS)).rejects.toBeInstanceOf(
        ProviderRegistryAllProvidersFailedError,
      );
    });

    it('rejects non-Error throws by stringifying them into the error message', async () => {
      const registry = new ProviderRegistry({ policy: 'any-flag-wins' });
      registry.register('a', {
        async checkAddress() {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw 'raw string failure';
        },
      });
      registry.register('clean', fakeProvider(false, 'list-a'));

      const detailed = await registry.checkAddressDetailed(ADDRESS);
      expect(detailed.errors).toEqual([{ name: 'a', error: 'raw string failure' }]);
    });
  });

  describe('registration bookkeeping', () => {
    it('throws when registering a duplicate name', () => {
      const registry = new ProviderRegistry({ policy: 'any-flag-wins' });
      registry.register('a', fakeProvider(false, 'list-a'));
      expect(() => registry.register('a', fakeProvider(true, 'list-b'))).toThrow(
        /already registered/,
      );
    });

    it('unregister removes a provider from future checks', async () => {
      const registry = new ProviderRegistry({ policy: 'any-flag-wins' });
      registry.register('a', fakeProvider(true, 'list-a'));
      registry.register('b', fakeProvider(false, 'list-b'));

      registry.unregister('a');

      expect(registry.listProviders()).toEqual(['b']);
      const result = await registry.checkAddress(ADDRESS);
      expect(result.flagged).toBe(false);
    });

    it('throws if checkAddress is called with no registered providers', async () => {
      const registry = new ProviderRegistry({ policy: 'any-flag-wins' });
      await expect(registry.checkAddress(ADDRESS)).rejects.toThrow(/no registered providers/);
    });
  });

  describe('interop with syncSanctionsToDenylist', () => {
    it('accepts a ProviderRegistry in place of a single SanctionsProvider', async () => {
      const registry = new ProviderRegistry({ policy: 'any-flag-wins' });
      registry.register('internal-denylist', fakeProvider(true, 'internal-v3'));
      registry.register('external-list', fakeProvider(false, 'sdn-list'));

      const writer: DenylistWriter & { addToDenylist: jest.Mock } = {
        addToDenylist: jest.fn().mockResolvedValue({ hash: 'fakehash' }),
      };

      const result = await syncSanctionsToDenylist({
        provider: registry,
        addresses: [ADDRESS],
        writer,
      });

      expect(result.flagged).toEqual([ADDRESS]);
      expect(writer.addToDenylist).toHaveBeenCalledWith(ADDRESS);
    });
  });
});
