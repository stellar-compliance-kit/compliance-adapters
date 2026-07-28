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

  it('asserts exact backoff delays across three consecutive failures', async () => {
    // This test explicitly verifies that backoff timing matches computeBackoffDelayMs's
    // exponential formula (baseMs * 2^attempt) for each attempt, ensuring contributors
    // can verify timing without relying on wall-clock time or flaky timing tolerances.
    const getEvents = jest.fn().mockRejectedValue(new Error('always down'));
    const eventSource: EventSource = { getEvents };
    const logger = makeLogger();
    const sleepCalls: number[] = [];

    const listener = new HorizonListener({
      eventSource,
      onEvent: jest.fn(),
      logger,
      maxRetries: 4, // Allow 4 attempts, fail on 4th
      backoffOptions: { jitter: false, baseMs: 100, maxMs: 10000 },
      sleep: async (ms: number) => {
        sleepCalls.push(ms);
      },
    });

    const startPromise = listener.start();
    startPromise.catch(() => {
      // asserted below via rejects.toThrow; swallow here so Node doesn't warn
      // about the rejection being "unhandled" while timers are advancing.
    });

    // Advance through each backoff delay; the listener will retry after each sleep
    const firstDelay = computeBackoffDelayMs(1, { jitter: false, baseMs: 100, maxMs: 10000 });
    const secondDelay = computeBackoffDelayMs(2, { jitter: false, baseMs: 100, maxMs: 10000 });
    const thirdDelay = computeBackoffDelayMs(3, { jitter: false, baseMs: 100, maxMs: 10000 });

    await jest.advanceTimersByTimeAsync(firstDelay);
    await jest.advanceTimersByTimeAsync(secondDelay);
    await jest.advanceTimersByTimeAsync(thirdDelay);

    await expect(startPromise).rejects.toThrow(/giving up/);

    // Verify getEvents was called 4 times (initial + 3 retries after backoff)
    expect(getEvents).toHaveBeenCalledTimes(4);

    // Verify sleep was called exactly 3 times with the correct delays
    // (no sleep before first attempt, sleep between each failure)
    expect(sleepCalls).toEqual([firstDelay, secondDelay, thirdDelay]);
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

  it('handles backpressure: processes multiple events in single poll batch', async () => {
    // Test verifies listener processes all events from one poll before sleeping,
    // ensuring efficient batching. This documents expected behavior when multiple
    // events arrive in a single poll response.
    const event1 = makeEvent({ id: 'event-1', ledger: 100 });
    const event2 = makeEvent({ id: 'event-2', ledger: 101 });

    const getEvents = jest
      .fn()
      .mockResolvedValueOnce({ events: [event1, event2], nextCursor: 'cursor-1' });

    const eventSource: EventSource = { getEvents };
    const received: RawContractEvent[] = [];

    const onEvent = jest.fn(async (event: RawContractEvent) => {
      received.push(event);
      if (received.length === 2) {
        listener.stop();
      }
    });

    const listener = new HorizonListener({
      eventSource,
      onEvent,
      pollIntervalMs: 500,
      sleep: async () => {},
    });

    await listener.start();

    // Both events should be processed from single poll
    expect(received).toHaveLength(2);
    expect(received[0].id).toBe('event-1');
    expect(received[1].id).toBe('event-2');
    // Only one poll was made since listener was stopped after processing
    expect(getEvents).toHaveBeenCalledTimes(1);
  });
});
