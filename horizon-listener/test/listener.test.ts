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

  describe('mode: poll (default)', () => {
    it('sleeps pollIntervalMs between every poll regardless of events returned', async () => {
      const getEvents = jest
        .fn()
        .mockResolvedValueOnce({ events: [makeEvent({ id: 'e-1' })], nextCursor: 'c1' })
        .mockResolvedValueOnce({ events: [], nextCursor: 'c1' })
        .mockResolvedValueOnce({ events: [makeEvent({ id: 'e-2' })], nextCursor: 'c2' });

      const eventSource: EventSource = { getEvents };
      const sleepCalls: number[] = [];
      let pollCount = 0;

      const listener = new HorizonListener({
        eventSource,
        onEvent: jest.fn(),
        mode: 'poll',
        pollIntervalMs: 5000,
        sleep: async (ms) => {
          sleepCalls.push(ms);
          pollCount++;
          // Stop after the third poll's sleep to avoid hanging
          if (pollCount >= 3) listener.stop();
        },
      });

      await listener.start();

      // Every poll sleeps pollIntervalMs, whether events were returned or not
      expect(sleepCalls).toEqual([5000, 5000, 5000]);
      expect(getEvents).toHaveBeenCalledTimes(3);
    });
  });

  describe('mode: stream', () => {
    it('polls again immediately when events are returned, sleeps only when poll is empty', async () => {
      const getEvents = jest
        .fn()
        // Active period: events returned → no sleep
        .mockResolvedValueOnce({ events: [makeEvent({ id: 'e-1' })], nextCursor: 'c1' })
        .mockResolvedValueOnce({ events: [makeEvent({ id: 'e-2' })], nextCursor: 'c2' })
        // Quiet period: no events → sleep pollIntervalMs
        .mockResolvedValueOnce({ events: [], nextCursor: 'c2' })
        // Active again
        .mockResolvedValueOnce({ events: [makeEvent({ id: 'e-3' })], nextCursor: 'c3' });

      const eventSource: EventSource = { getEvents };
      const sleepCalls: number[] = [];
      const received: string[] = [];

      const listener = new HorizonListener({
        eventSource,
        onEvent: (event) => {
          received.push(event.id);
          if (event.id === 'e-3') listener.stop();
        },
        mode: 'stream',
        pollIntervalMs: 5000,
        sleep: async (ms) => {
          sleepCalls.push(ms);
        },
      });

      await listener.start();

      expect(received).toEqual(['e-1', 'e-2', 'e-3']);
      // Only slept once: during the quiet period (empty poll)
      expect(sleepCalls).toEqual([5000]);
      expect(getEvents).toHaveBeenCalledTimes(4);
    });

    it('falls back to pollIntervalMs during consecutive quiet polls', async () => {
      const getEvents = jest
        .fn()
        .mockResolvedValueOnce({ events: [], nextCursor: 'c0' })
        .mockResolvedValueOnce({ events: [], nextCursor: 'c0' })
        .mockResolvedValueOnce({ events: [makeEvent({ id: 'e-1' })], nextCursor: 'c1' });

      const eventSource: EventSource = { getEvents };
      const sleepCalls: number[] = [];

      const listener = new HorizonListener({
        eventSource,
        onEvent: () => {
          listener.stop();
        },
        mode: 'stream',
        pollIntervalMs: 3000,
        sleep: async (ms) => {
          sleepCalls.push(ms);
        },
      });

      await listener.start();

      // Two empty polls = two sleeps at pollIntervalMs
      expect(sleepCalls).toEqual([3000, 3000]);
    });
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
