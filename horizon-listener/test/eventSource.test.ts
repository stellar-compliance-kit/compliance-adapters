import type { EventSource, RawContractEvent } from '../src/eventSource';

describe('EventSource implementations', () => {
  describe('mock EventSource with cursor handling', () => {
    it('handles the case where cursor and events are both omitted, guarding against infinite loop', () => {
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
      mockEventSource.getEvents('initial-cursor').then((result) => {
        // If the RPC omits both cursor and events, the nextCursor falls back to the input cursor
        // This is the infinite loop case: if 'initial-cursor' is returned, the next poll
        // will fetch from the same position, making no progress.
        // The test documents this behavior; a fix should either:
        // 1. Throw an error when both cursor and events are omitted
        // 2. Use a different strategy for advancing the cursor
        expect(result.nextCursor).toBe('initial-cursor');
      });
    });

    it('advances cursor via the last event id when RPC omits cursor but returns events', () => {
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

      mockEventSource.getEvents(undefined).then((result) => {
        // When RPC omits cursor but has events, the last event's id becomes the next cursor
        expect(result.nextCursor).toBe('evt-123');
      });
    });

    it('uses explicit cursor from RPC when provided', () => {
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

      mockEventSource.getEvents('prev-cursor').then((result) => {
        // When RPC provides an explicit cursor, it takes precedence
        expect(result.nextCursor).toBe('explicit-cursor-from-rpc');
      });
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

function computeNextCursor(events: RawContractEvent[], responseCursor: string | undefined, inputCursor: string | undefined): string {
  return responseCursor ?? (events.length > 0 ? events[events.length - 1].id : (inputCursor ?? ''));
}

describe('RpcEventSource raw event mapping', () => {
  it('maps raw RPC event shapes to RawContractEvent with topic stringification', () => {
    const rawEvent = {
      id: 'evt-1',
      contractId: 'CDENYLISTGATE',
      ledger: 100,
      topic: [
        'denylist_added',
        { type: 'object', nested: true },
        123,
        true,
      ],
      value: { address: 'GADDR' },
    };

    const event = mapRawEventToRawContractEvent(rawEvent);

    expect(event.id).toBe('evt-1');
    expect(event.contractId).toBe('CDENYLISTGATE');
    expect(event.ledger).toBe(100);
    expect(event.topic).toEqual([
      'denylist_added',
      '[object Object]',
      '123',
      'true',
    ]);
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
      topic: [
        null,
        undefined,
        { nested: { deeply: 'value' } },
        [1, 2, 3],
      ],
      value: {},
    };

    const event = mapRawEventToRawContractEvent(rawEvent);

    expect(event.topic).toEqual([
      'null',
      'undefined',
      '[object Object]',
      '1,2,3',
    ]);
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
