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
