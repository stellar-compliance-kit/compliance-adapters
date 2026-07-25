import { HorizonListener } from '../src/listener';
import type { EventSource, RawContractEvent } from '../src/eventSource';
import { computeBackoffDelayMs } from '../src/backoff';

function makeLogger() {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function makeEvent(overrides: Partial<RawContractEvent> = {}): RawContractEvent {
  return {
    id: 'evt-1',
    contractId: 'CDENYLISTGATE',
    ledger: 1,
    topic: ['denylist_added'],
    value: {},
    ...overrides,
  };
}

describe('HorizonListener', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('processes events across two polls in order, threading the returned cursor', async () => {
    const eventA = makeEvent({ id: 'evt-1' });
    const eventB = makeEvent({ id: 'evt-2', topic: ['denylist_removed'] });

    const getEvents = jest
      .fn()
      .mockResolvedValueOnce({ events: [eventA], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ events: [eventB], nextCursor: 'cursor-2' });

    const eventSource: EventSource = { getEvents };
    const received: RawContractEvent[] = [];

    // Injecting an instant sleep keeps this test focused on ordering/cursor
    // threading; the dedicated backoff test below exercises real wait timing.
    const listener: HorizonListener = new HorizonListener({
      eventSource,
      onEvent: (event) => {
        received.push(event);
        if (event.id === 'evt-2') {
          listener.stop();
        }
      },
      sleep: async () => {},
    });

    await listener.start();

    expect(received).toEqual([eventA, eventB]);
    expect(getEvents).toHaveBeenNthCalledWith(1, undefined);
    expect(getEvents).toHaveBeenNthCalledWith(2, 'cursor-1');
  });

  it('backs off between failed polls and recovers once getEvents succeeds again', async () => {
    const successEvent = makeEvent({ id: 'evt-recovered' });

    const getEvents = jest
      .fn()
      .mockRejectedValueOnce(new Error('rpc unreachable'))
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce({ events: [successEvent], nextCursor: 'cursor-success' });

    const eventSource: EventSource = { getEvents };
    const logger = makeLogger();
    const onEvent = jest.fn((_event: RawContractEvent) => {
      listener.stop();
    });

    // jitter disabled so the exact delay for each attempt is assertable against
    // computeBackoffDelayMs's own formula.
    const listener: HorizonListener = new HorizonListener({
      eventSource,
      onEvent,
      logger,
      backoffOptions: { jitter: false },
    });

    const startPromise = listener.start();

    const firstDelay = computeBackoffDelayMs(1, { jitter: false });
    const secondDelay = computeBackoffDelayMs(2, { jitter: false });

    await jest.advanceTimersByTimeAsync(firstDelay);
    await jest.advanceTimersByTimeAsync(secondDelay);

    await startPromise;

    expect(getEvents).toHaveBeenCalledTimes(3);
    expect(onEvent).toHaveBeenCalledWith(successEvent);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('rejects once maxRetries consecutive failures are exceeded', async () => {
    const getEvents = jest.fn().mockRejectedValue(new Error('always down'));
    const eventSource: EventSource = { getEvents };
    const logger = makeLogger();

    const listener = new HorizonListener({
      eventSource,
      onEvent: jest.fn(),
      logger,
      maxRetries: 3,
      backoffOptions: { jitter: false, baseMs: 10, maxMs: 1000 },
    });

    const startPromise = listener.start();
    startPromise.catch(() => {
      // asserted below via rejects.toThrow; swallow here so Node doesn't warn
      // about the rejection being "unhandled" while timers are advancing.
    });

    const firstDelay = computeBackoffDelayMs(1, { jitter: false, baseMs: 10, maxMs: 1000 });
    const secondDelay = computeBackoffDelayMs(2, { jitter: false, baseMs: 10, maxMs: 1000 });

    await jest.advanceTimersByTimeAsync(firstDelay);
    await jest.advanceTimersByTimeAsync(secondDelay);

    await expect(startPromise).rejects.toThrow(/giving up/);
    expect(getEvents).toHaveBeenCalledTimes(3);
  });

  it('backfills all historical pages before switching to live polling', async () => {
    const page1Events = [makeEvent({ id: 'h-1', ledger: 100 }), makeEvent({ id: 'h-2', ledger: 101 })];
    const page2Events = [makeEvent({ id: 'h-3', ledger: 102 })];
    const liveEvent = makeEvent({ id: 'live-1', ledger: 200 });

    const getEvents = jest
      .fn()
      // Backfill pages
      .mockResolvedValueOnce({ events: page1Events, nextCursor: 'cursor-p1' })
      .mockResolvedValueOnce({ events: page2Events, nextCursor: 'cursor-p2' })
      // Empty page signals backfill complete
      .mockResolvedValueOnce({ events: [], nextCursor: 'cursor-p2' })
      // Live polling
      .mockResolvedValueOnce({ events: [liveEvent], nextCursor: 'cursor-live' });

    const eventSource: EventSource = { getEvents };
    const received: RawContractEvent[] = [];
    const logger = makeLogger();
    const sleepCalls: number[] = [];

    const listener = new HorizonListener({
      eventSource,
      onEvent: (event) => {
        received.push(event);
        if (event.id === 'live-1') {
          listener.stop();
        }
      },
      logger,
      startLedger: 100,
      pollIntervalMs: 5000,
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    await listener.start();

    // All events consumed in page order, no duplicates or gaps
    expect(received).toEqual([...page1Events, ...page2Events, liveEvent]);

    // Cursor threaded correctly across pages
    expect(getEvents).toHaveBeenNthCalledWith(1, undefined);
    expect(getEvents).toHaveBeenNthCalledWith(2, 'cursor-p1');
    expect(getEvents).toHaveBeenNthCalledWith(3, 'cursor-p2');
    expect(getEvents).toHaveBeenNthCalledWith(4, 'cursor-p2');

    // During backfill (pages 1-3), no sleep between pages.
    // Only the live poll (after backfill) sleeps with pollIntervalMs.
    expect(sleepCalls).toEqual([5000]);

    // Verify the backfill-complete log was emitted
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('backfill complete'),
    );
  });

  it('pages through all historical events without skipping or duplicating at boundaries', async () => {
    // Simulates three full pages at exact page-boundary cursors
    const pages = [
      [makeEvent({ id: 'e-1' }), makeEvent({ id: 'e-2' }), makeEvent({ id: 'e-3' })],
      [makeEvent({ id: 'e-4' }), makeEvent({ id: 'e-5' }), makeEvent({ id: 'e-6' })],
      [makeEvent({ id: 'e-7' })],
    ];

    const getEvents = jest
      .fn()
      .mockResolvedValueOnce({ events: pages[0], nextCursor: 'c1' })
      .mockResolvedValueOnce({ events: pages[1], nextCursor: 'c2' })
      .mockResolvedValueOnce({ events: pages[2], nextCursor: 'c3' })
      .mockResolvedValueOnce({ events: [], nextCursor: 'c3' });

    const eventSource: EventSource = { getEvents };
    const received: string[] = [];

    const listener = new HorizonListener({
      eventSource,
      onEvent: (event) => {
        received.push(event.id);
      },
      startLedger: 1,
      sleep: async () => {
        // After backfill completes, stop on the next live poll sleep
        listener.stop();
      },
    });

    await listener.start();

    // Every event from every page, in order, no duplicates
    expect(received).toEqual(['e-1', 'e-2', 'e-3', 'e-4', 'e-5', 'e-6', 'e-7']);

    // Exactly 4 calls: 3 pages with events + 1 empty page to end backfill
    expect(getEvents).toHaveBeenCalledTimes(4);
  });

  it('stop() causes the polling loop to exit and start() to resolve rather than hang', async () => {
    const getEvents = jest.fn().mockResolvedValue({ events: [], nextCursor: 'same-cursor' });
    const eventSource: EventSource = { getEvents };

    const listener = new HorizonListener({
      eventSource,
      onEvent: jest.fn(),
      pollIntervalMs: 1000,
      sleep: async () => {},
    });

    const startPromise = listener.start();
    listener.stop();

    await expect(startPromise).resolves.toBeUndefined();
  });
});
