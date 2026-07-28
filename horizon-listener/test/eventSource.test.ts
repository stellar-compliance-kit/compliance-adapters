import type { RawContractEvent } from '../src/eventSource';

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
