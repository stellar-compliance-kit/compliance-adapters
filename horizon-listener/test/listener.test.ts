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

  it('calls onEventFailure when onEvent throws, providing the failed event and error', async () => {
    const eventA = makeEvent({ id: 'evt-1' });
    const eventB = makeEvent({ id: 'evt-2', topic: ['denylist_removed'] });

    const getEvents = jest
      .fn()
      .mockResolvedValueOnce({ events: [eventA, eventB], nextCursor: 'cursor-1' });

    const eventSource: EventSource = { getEvents };
    const eventError = new Error('event processing failed');
    const onEvent = jest
      .fn()
      .mockImplementationOnce(() => {
        throw eventError;
      })
      .mockImplementationOnce(() => {
        // second event succeeds
      });

    const onEventFailure = jest.fn();
    const logger = makeLogger();

    const listener = new HorizonListener({
      eventSource,
      onEvent,
      onEventFailure,
      logger,
      sleep: async () => {
        listener.stop();
      },
    });

    await listener.start();

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEventFailure).toHaveBeenCalledTimes(1);
    expect(onEventFailure).toHaveBeenCalledWith(eventA, eventError);
    expect(onEvent).toHaveBeenNthCalledWith(1, eventA);
    expect(onEvent).toHaveBeenNthCalledWith(2, eventB);
  });

  it('handles onEventFailure callback errors without interrupting the listener', async () => {
    const eventA = makeEvent({ id: 'evt-1' });

    const getEvents = jest
      .fn()
      .mockResolvedValueOnce({ events: [eventA], nextCursor: 'cursor-1' });

    const eventSource: EventSource = { getEvents };
    const eventError = new Error('event failed');
    const failureError = new Error('failure handler failed');
    const onEvent = jest.fn().mockImplementationOnce(() => {
      throw eventError;
    });

    const onEventFailure = jest.fn().mockImplementationOnce(() => {
      throw failureError;
    });

    const logger = makeLogger();

    const listener = new HorizonListener({
      eventSource,
      onEvent,
      onEventFailure,
      logger,
      sleep: async () => {
        listener.stop();
      },
    });

    await listener.start();

    expect(onEventFailure).toHaveBeenCalledWith(eventA, eventError);
    expect(logger.error).toHaveBeenCalledWith(
      'horizon-listener: onEventFailure handler threw',
      failureError,
    );
  });

  it('supports calling stop() during backoff delay to exit promptly', async () => {
    const getEvents = jest.fn().mockRejectedValue(new Error('rpc down'));
    const eventSource: EventSource = { getEvents };
    const logger = makeLogger();

    const listener = new HorizonListener({
      eventSource,
      onEvent: jest.fn(),
      logger,
      maxRetries: 5,
      backoffOptions: { jitter: false, baseMs: 1000, maxMs: 10000 },
    });

    const startPromise = listener.start();
    startPromise.catch(() => {
      // swallow rejection so Node doesn't warn about unhandled rejection
    });

    // Advance to trigger first failure and backoff
    await jest.advanceTimersByTimeAsync(0);

    // Call stop() while sleeping; should exit the loop
    listener.stop();

    // Should resolve (not reject) after a brief moment
    await expect(startPromise).resolves.toBeUndefined();
  });

  it('interrupts poll interval sleep when stop() is called', async () => {
    const eventA = makeEvent({ id: 'evt-1' });
    const getEvents = jest.fn().mockResolvedValue({ events: [eventA], nextCursor: 'cursor-1' });
    const eventSource: EventSource = { getEvents };
    const onEvent = jest.fn();

    const listener = new HorizonListener({
      eventSource,
      onEvent,
      pollIntervalMs: 10000,
    });

    const startPromise = listener.start();

    // Let the first poll complete
    await jest.advanceTimersByTimeAsync(0);

    // Listener is now sleeping for pollIntervalMs (10000ms)
    // Call stop() during the sleep
    listener.stop();

    // Should resolve immediately without waiting the full poll interval
    await expect(startPromise).resolves.toBeUndefined();
  });
});
