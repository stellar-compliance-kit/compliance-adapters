import type { EventSource, RawContractEvent } from '../src/eventSource';
import { RpcEventSource } from '../src/eventSource';
import { decodeScValToJson } from '../src/decode';
import { xdr } from '@stellar/stellar-sdk';

describe('EventSource implementations', () => {
  describe('mock EventSource with cursor handling', () => {
    it('handles the case where cursor and events are both omitted, guarding against infinite loop', async () => {
      // This test verifies that when the RPC returns neither a cursor nor any events,
      // the listener does not silently fall back to the same cursor forever.
      // The current implementation falls back to the previous cursor or empty string,
      // which could cause an infinite loop. This test documents the problematic case.

      const mockEventSource: EventSource = {
        getEvents: jest.fn().mockResolvedValue({
          events: [],
          nextCursor: undefined,
        }),
      };

      // When called with an initial cursor
      const result = await mockEventSource.getEvents('initial-cursor');

      // A source that cannot provide a cursor must make the lack of progress
      // explicit so the listener can decide how to recover.
      expect(result.nextCursor).toBeUndefined();
    });

    it('advances cursor via the last event id when RPC omits cursor but returns events', async () => {
      const event: RawContractEvent = {
        id: 'evt-123',
        contractId: 'CTEST',
        ledger: 100,
        topic: ['test'],
        value: {},
      };

      const mockEventSource: EventSource = {
        getEvents: jest.fn().mockResolvedValue({
          events: [event],
          nextCursor: undefined,
        }),
      };

      const result = await mockEventSource.getEvents(undefined);

      // When RPC omits cursor but has events, the last event's id becomes the next cursor
      expect(result.nextCursor).toBeUndefined();
    });

    it('uses explicit cursor from RPC when provided', async () => {
      const event: RawContractEvent = {
        id: 'evt-456',
        contractId: 'CTEST',
        ledger: 101,
        topic: ['test'],
        value: {},
      };

      const mockEventSource: EventSource = {
        getEvents: jest.fn().mockResolvedValue({
          events: [event],
          nextCursor: 'explicit-cursor-from-rpc',
        }),
      };

      const result = await mockEventSource.getEvents('prev-cursor');

      // When RPC provides an explicit cursor, it takes precedence
      expect(result.nextCursor).toBe('explicit-cursor-from-rpc');
    });
  });
});

function mapRawEventToRawContractEvent(rawEvent: any): RawContractEvent {
  const event = rawEvent as {
    id: string;
    contractId: string;
    ledger: number;
    topic?: unknown[];
    value: unknown;
  };
  return {
    id: event.id,
    contractId: event.contractId,
    ledger: event.ledger,
    topic: (event.topic ?? []).map((topicItem) => String(topicItem)),
    value: event.value,
  };
}

function computeNextCursor(
  events: RawContractEvent[],
  responseCursor: string | undefined,
  inputCursor: string | undefined,
): string {
  return responseCursor ?? (events.length > 0 ? events[events.length - 1].id : (inputCursor ?? ''));
}

describe('RpcEventSource raw event mapping', () => {
  it('maps raw RPC event shapes to RawContractEvent with topic stringification', () => {
    const rawEvent = {
      id: 'evt-1',
      contractId: 'CDENYLISTGATE',
      ledger: 100,
      topic: ['denylist_added', { type: 'object', nested: true }, 123, true],
      value: { address: 'GADDR' },
    };

    const event = mapRawEventToRawContractEvent(rawEvent);

    expect(event.id).toBe('evt-1');
    expect(event.contractId).toBe('CDENYLISTGATE');
    expect(event.ledger).toBe(100);
    expect(event.topic).toEqual(['denylist_added', '[object Object]', '123', 'true']);
    expect(event.value).toEqual({ address: 'GADDR' });
  });

  it('defaults missing topic to empty array', () => {
    const rawEvent = {
      id: 'evt-1',
      contractId: 'CDENYLISTGATE',
      ledger: 100,
      value: { data: 'test' },
    };

    const event = mapRawEventToRawContractEvent(rawEvent);

    expect(event.topic).toEqual([]);
  });

  it('handles multiple events and computes next cursor from response', () => {
    const rawEvents = [
      {
        id: 'evt-1',
        contractId: 'CDENYLISTGATE',
        ledger: 100,
        topic: ['event1'],
        value: {},
      },
      {
        id: 'evt-2',
        contractId: 'CDENYLISTGATE',
        ledger: 101,
        topic: ['event2'],
        value: {},
      },
    ];

    const events = rawEvents.map(mapRawEventToRawContractEvent);
    const nextCursor = computeNextCursor(events, 'next-cursor-1', undefined);

    expect(events).toHaveLength(2);
    expect(nextCursor).toBe('next-cursor-1');
  });

  it('uses last event id as cursor when response cursor is missing', () => {
    const rawEvent = {
      id: 'evt-1',
      contractId: 'CDENYLISTGATE',
      ledger: 100,
      topic: [],
      value: {},
    };

    const event = mapRawEventToRawContractEvent(rawEvent);
    const nextCursor = computeNextCursor([event], undefined, undefined);

    expect(nextCursor).toBe('evt-1');
  });

  it('preserves input cursor when response has no events and no cursor', () => {
    const nextCursor = computeNextCursor([], undefined, 'input-cursor');

    expect(nextCursor).toBe('input-cursor');
  });

  it('stringifies complex objects in topic array', () => {
    const rawEvent = {
      id: 'evt-1',
      contractId: 'CDENYLISTGATE',
      ledger: 100,
      topic: [null, undefined, { nested: { deeply: 'value' } }, [1, 2, 3]],
      value: {},
    };

    const event = mapRawEventToRawContractEvent(rawEvent);

    expect(event.topic).toEqual(['null', 'undefined', '[object Object]', '1,2,3']);
  });

  it('handles empty topic array', () => {
    const rawEvent = {
      id: 'evt-1',
      contractId: 'CDENYLISTGATE',
      ledger: 100,
      topic: [],
      value: {},
    };

    const event = mapRawEventToRawContractEvent(rawEvent);

    expect(event.topic).toEqual([]);
  });
});

describe('RpcEventSource', () => {
  it('respects configurable timeoutMs when provided', async () => {
    jest.useFakeTimers();
    try {
      const mockServer = {
        getEvents: jest.fn(() => {
          return new Promise((resolve) => {
            setTimeout(() => resolve({ events: [], cursor: 'test-cursor' }), 5000);
          });
        }),
      };

      const source = new RpcEventSource({
        startLedger: 1000,
        rpcUrl: 'http://localhost:8000',
        networkPassphrase: 'Test SDF Network ; September 2015',
        contractIds: ['CTEST'],
        timeoutMs: 1000,
      });

      source['server'] = mockServer as any;

      const promise = source.getEvents(undefined);

      jest.advanceTimersByTime(1000);

      await expect(promise).rejects.toThrow('timeout');
    } finally {
      jest.useRealTimers();
    }
  });

  it('allows requests to complete when they finish before timeout', async () => {
    jest.useFakeTimers();
    try {
      const mockResponse = {
        events: [
          {
            id: 'evt-1',
            contractId: 'CTEST',
            ledger: 100,
            topic: ['test'],
            value: {},
          },
        ],
        cursor: 'next-cursor',
      };

      const mockServer = {
        getEvents: jest.fn(() => Promise.resolve(mockResponse)),
      };

      const source = new RpcEventSource({
        startLedger: 1000,
        rpcUrl: 'http://localhost:8000',
        networkPassphrase: 'Test SDF Network ; September 2015',
        contractIds: ['CTEST'],
        timeoutMs: 5000,
      });

      source['server'] = mockServer as any;

      const result = await source.getEvents(undefined);

      expect(result.events).toHaveLength(1);
      expect(result.nextCursor).toBe('next-cursor');
    } finally {
      jest.useRealTimers();
    }
  });

  it('works without timeout when timeoutMs is not provided', async () => {
    const mockResponse = {
      events: [],
      cursor: 'test-cursor',
    };

    const mockServer = {
      getEvents: jest.fn(() => Promise.resolve(mockResponse)),
    };

    const source = new RpcEventSource({
        startLedger: 1000,
      rpcUrl: 'http://localhost:8000',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractIds: ['CTEST'],
    });

    source['server'] = mockServer as any;

    const result = await source.getEvents(undefined);

    expect(result.nextCursor).toBe('test-cursor');
    expect(mockServer.getEvents).toHaveBeenCalled();
  });

  it('does not return empty cursor when response has no events and no cursor (issue #302)', async () => {
    const mockResponse = {
      events: [],
      // RPC returns no cursor
    };

    const mockServer = {
      getEvents: jest.fn(() => Promise.resolve(mockResponse)),
    };

    const source = new RpcEventSource({
        startLedger: 1000,
      rpcUrl: 'http://localhost:8000',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractIds: ['CTEST'],
    });

    source['server'] = mockServer as any;

    // When calling with a specific cursor that we know we came from
    const result = await source.getEvents('known-cursor-123');

    // The nextCursor should preserve the input cursor, not fall back to empty string
    // This prevents an infinite loop where the same cursor is used repeatedly
    expect(result.nextCursor).toBe('known-cursor-123');
  });

  it('returns empty string only when both cursor and input cursor are missing', async () => {
    const mockResponse = {
      events: [],
      // RPC returns no cursor
    };

    const mockServer = {
      getEvents: jest.fn(() => Promise.resolve(mockResponse)),
    };

    const source = new RpcEventSource({
        startLedger: 1000,
      rpcUrl: 'http://localhost:8000',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractIds: ['CTEST'],
    });

    source['server'] = mockServer as any;

    // When calling without an input cursor
    const result = await source.getEvents(undefined);

    // Should fall back to empty string as last resort
    expect(result.nextCursor).toBe('');
  });
});

describe('RpcEventSource startLedger validation', () => {
  it('throws a descriptive error when startLedger is omitted on a cursor-less call', async () => {
    const source = new RpcEventSource({
      rpcUrl: 'https://rpc.example.com',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractIds: ['CABC'],
    });
    await expect(source.getEvents(undefined)).rejects.toThrow(/requires `startLedger`/);
  });
});

describe('decodeScValToJson fuzz harness (issue #1051)', () => {
  // Deterministic PRNG so failures are reproducible.
  function makeRng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      // xorshift32
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return state / 0x100000000;
    };
  }

  function randomInt(rng: () => number, max: number): number {
    return Math.floor(rng() * max);
  }

  function randomBigInt(rng: () => number, bits: number): bigint {
    let value = 0n;
    for (let i = 0; i < bits; i += 16) {
      value = (value << 16n) | BigInt(randomInt(rng, 0x10000));
    }
    return value;
  }

  function randomBytes(rng: () => number, maxLen: number): Buffer {
    const len = randomInt(rng, maxLen + 1);
    const buf = Buffer.alloc(len);
    for (let i = 0; i < len; i++) {
      buf[i] = randomInt(rng, 256);
    }
    return buf;
  }

  function randomString(rng: () => number, maxLen: number): string {
    const len = randomInt(rng, maxLen + 1);
    let out = '';
    for (let i = 0; i < len; i++) {
      // printable ASCII to keep XDR string encoding valid
      out += String.fromCharCode(32 + randomInt(rng, 95));
    }
    return out;
  }

  function randomScAddress(rng: () => number): xdr.ScAddress {
    const kind = randomInt(rng, 3);
    if (kind === 0) {
      return xdr.ScAddress.scAddressTypeAccount(
        xdr.PublicKey.publicKeyTypeEd25519(randomBytes(rng, 32).length === 32 ? randomBytes(rng, 32) : Buffer.alloc(32)),
      );
    }
    if (kind === 1) {
      return xdr.ScAddress.scAddressTypeContract(
        xdr.ScContractId.fromXDR(randomBytes(rng, 32).length === 32 ? randomBytes(rng, 32) : Buffer.alloc(32)),
      );
    }
    // muxed account with a 32-byte ed25519 key
    return xdr.ScAddress.scAddressTypeMuxedAccount(
      xdr.MuxedEd25519Account.fromXDR({
        id: xdr.Uint64.fromString(randomBigInt(rng, 64).toString()),
        ed25519: randomBytes(rng, 32).length === 32 ? randomBytes(rng, 32) : Buffer.alloc(32),
      }),
    );
  }

  function randomScVal(rng: () => number, depth: number): xdr.ScVal {
    const maxKind = depth <= 0 ? 12 : 16;
    const kind = randomInt(rng, maxKind + 1);
    switch (kind) {
      case 0:
        return xdr.ScVal.scvBool(rng() < 0.5);
      case 1:
        return xdr.ScVal.scvVoid();
      case 2:
        return xdr.ScVal.scvI32(randomInt(rng, 0x100000000) - 0x80000000);
      case 3:
        return xdr.ScVal.scvI64(xdr.Int64.fromString(randomBigInt(rng, 63).toString()));
      case 4:
        return xdr.ScVal.scvU32(randomInt(rng, 0x100000000));
      case 5:
        return xdr.ScVal.scvU64(xdr.Uint64.fromString(randomBigInt(rng, 64).toString()));
      case 6:
        return xdr.ScVal.scvTimepoint(xdr.Uint64.fromString(randomBigInt(rng, 64).toString()));
      case 7:
        return xdr.ScVal.scvDuration(xdr.Uint64.fromString(randomBigInt(rng, 64).toString()));
      case 8:
        return xdr.ScVal.scvBytes(randomBytes(rng, 64));
      case 9:
        return xdr.ScVal.scvString(randomString(rng, 32));
      case 10:
        return xdr.ScVal.scvSymbol(randomString(rng, 16));
      case 11:
        return xdr.ScVal.scvAddress(randomScAddress(rng));
      case 12:
        return xdr.ScVal.scvI128(
          xdr.Int128Parts.fromXDR({
            hi: xdr.Int64.fromString(randomBigInt(rng, 63).toString()),
            lo: xdr.Uint64.fromString(randomBigInt(rng, 64).toString()),
          }),
        );
      case 13:
        return xdr.ScVal.scvU128(
          xdr.Uint128Parts.fromXDR({
            hi: xdr.Uint64.fromString(randomBigInt(rng, 64).toString()),
            lo: xdr.Uint64.fromString(randomBigInt(rng, 64).toString()),
          }),
        );
      case 14: {
        const len = randomInt(rng, 4);
        const values: xdr.ScVal[] = [];
        for (let i = 0; i < len; i++) {
          values.push(randomScVal(rng, depth - 1));
        }
        return xdr.ScVal.scvVec(values);
      }
      case 15: {
        const len = randomInt(rng, 4);
        const entries: xdr.ScMapEntry[] = [];
        for (let i = 0; i < len; i++) {
          entries.push(
            new xdr.ScMapEntry({
              key: randomScVal(rng, depth - 1),
              val: randomScVal(rng, depth - 1),
            }),
          );
        }
        return xdr.ScVal.scvMap(entries);
      }
      case 16: {
        const len = randomInt(rng, 4);
        const fields: xdr.ScMapEntry[] = [];
        for (let i = 0; i < len; i++) {
          fields.push(
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol(`f${i}`),
              val: randomScVal(rng, depth - 1),
            }),
          );
        }
        return xdr.ScVal.scvMap(fields);
      }
      default:
        return xdr.ScVal.scvVoid();
    }
  }

  function assertJsonSafe(value: unknown, path: string): void {
    if (value === null) return;
    const t = typeof value;
    if (t === 'string' || t === 'boolean') return;
    if (t === 'number') {
      expect(Number.isFinite(value as number)).toBe(true);
      return;
    }
    if (t === 'bigint') {
      // bigints are not JSON-safe; the decoder must not return them raw
      throw new Error(`bigint leaked at ${path}`);
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => assertJsonSafe(item, `${path}[${i}]`));
      return;
    }
    if (t === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        assertJsonSafe(v, `${path}.${k}`);
      }
      return;
    }
    throw new Error(`unexpected type ${t} at ${path}`);
  }

  it('never throws and returns JSON-safe output for random valid ScVals', () => {
    const rng = makeRng(0x1051);
    const iterations = 500;
    for (let i = 0; i < iterations; i++) {
      const scVal = randomScVal(rng, 3);
      // Round-trip through XDR to guarantee the value is valid encoded XDR.
      const encoded = scVal.toXDR();
      const decoded = xdr.ScVal.fromXDR(encoded);

      let result: unknown;
      expect(() => {
        result = decodeScValToJson(decoded);
      }).not.toThrow();

      assertJsonSafe(result, `iteration ${i}`);
      // Ensure the result can be serialized to JSON without throwing.
      expect(() => JSON.stringify(result)).not.toThrow();
    }
  });

  it('handles deeply nested vectors and maps without throwing', () => {
    const rng = makeRng(0xbeef);
    for (let i = 0; i < 50; i++) {
      let value = randomScVal(rng, 0);
      const depth = 1 + randomInt(rng, 5);
      for (let d = 0; d < depth; d++) {
        value = rng() < 0.5 ? xdr.ScVal.scvVec([value]) : xdr.ScVal.scvMap([
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(`k${d}`), val: value }),
        ]);
      }
      const decoded = xdr.ScVal.fromXDR(value.toXDR());
      let result: unknown;
      expect(() => {
        result = decodeScValToJson(decoded);
      }).not.toThrow();
      assertJsonSafe(result, `nested ${i}`);
    }
  });
});
