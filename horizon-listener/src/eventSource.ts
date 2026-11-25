/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { rpc } from '@stellar/stellar-sdk';
import { type EventDecodeMode, decodeScValToJson, decodeTopicToString } from './decode';

/**
 * A normalised representation of a single Soroban contract event as returned
 * by the Soroban RPC `getEvents` endpoint.
 *
 * Field shapes are derived from the Stellar SDK's `rpc.Server.getEvents`
 * response. Only the fields needed by the listener pipeline are surfaced here;
 * the rest are intentionally dropped so downstream code isn't coupled to every
 * SDK version's response shape.
 */
export interface RawContractEvent {
  /**
   * Opaque, globally-unique event identifier assigned by the Soroban RPC
   * node. Formatted as `<ledger_sequence>-<event_index>` (e.g.
   * `"4611686018427388004-1"`). Safe to use as a pagination cursor — passing
   * it back as the `cursor` argument to {@link EventSource.getEvents} will
   * resume the stream from the event that immediately follows this one.
   */
  id: string;

  /**
   * The `C…` StrKey-encoded Soroban contract address that emitted the event.
   * Useful for routing events to the correct handler when a single listener
   * subscribes to multiple contracts.
   */
  contractId: string;

  /**
   * The ledger sequence number in which this event was included. Monotonically
   * increasing; can be used to track the highest processed ledger and choose a
   * safe `startLedger` value on restart.
   */
  ledger: number;

  /**
   * Ordered list of topic segments that categorise the event. Each element is
   * the result of calling `String()` on the raw SDK topic value, which
   * serialises Soroban `ScVal` topic entries as their human-readable string
   * representation (e.g. `"SymbolSmall(add)"`, `"Address(G…)"`) rather than
   * raw bytes. Consumers that need the original `ScVal` structure should parse
   * these strings or extend this interface to carry the raw SDK value instead.
   */
  topic: string[];

  /**
   * The event's data payload as emitted by the contract. The shape depends
   * entirely on the emitting contract and event type; callers must narrow this
   * with a type guard or cast after inspecting `topic` to determine the event
   * kind.
   */
  value: unknown;
}

/**
 * The seam the listener pipeline depends on for fetching contract events.
 * Implement this interface to plug in a custom transport (e.g. a mock in tests
 * or a caching proxy) instead of {@link RpcEventSource}.
 *
 * @example
 * ```ts
 * const source: EventSource = {
 *   async getEvents(cursor) {
 *     return { events: [], nextCursor: cursor ?? '' };
 *   },
 * };
 * const { events, nextCursor } = await source.getEvents(undefined);
 * ```
 */
export interface EventSource {
  /**
   * Fetches the next page of contract events.
   *
   * @param cursor - Opaque cursor from a previous call's `nextCursor`, or
   *   `undefined` to start from the configured `startLedger`.
   * @returns The page of events, the cursor to resume from, and optionally the
   *   latest ledger known to the RPC node.
   *
   * @example
   * ```ts
   * const page = await source.getEvents(undefined);
   * const next = await source.getEvents(page.nextCursor);
   * ```
   */
  getEvents(
    cursor: string | undefined,
  ): Promise<{ events: RawContractEvent[]; nextCursor: string; latestLedger?: number }>;
}

export interface RpcEventSourceOptions {
  /** Single RPC endpoint. Either `rpcUrl` or `rpcUrls` is required. */
  rpcUrl?: string;
  /**
   * Ordered list of RPC endpoints for failover. The first entry is the
   * primary; after `failoverAfter` consecutive failures the source rotates to
   * the next URL (the listener's cursor is kept, so no events are skipped).
   */
  rpcUrls?: string[];
  /** Consecutive failures on one URL before rotating to the next. @default 3 */
  failoverAfter?: number;
  /** How long to stay on a fallback before retrying the primary. @default 60000 */
  primaryCooldownMs?: number;
  /** Called whenever the active URL changes. */
  onFailover?: (from: string, to: string) => void;
  /** Records an `rpc_failover` counter increment on every rotation. */
  metrics?: AnyMetricsRegistry;
  networkPassphrase: string;
  contractIds: string[];
  // Soroban RPC requires a starting ledger for the very first (cursor-less)
  // call; callers should pass a recent ledger they know is within the RPC's
  // retention window (commonly ~24h / 17,280 ledgers). Left undefined, the
  // first cursor-less getEvents call throws a descriptive error rather than
  // falling back to ledger 0, which real RPC nodes reject.
  startLedger?: number;
  // Optional timeout in milliseconds for the RPC getEvents call.
  // If the call takes longer than this, it will be rejected.
  // Left undefined, no timeout is applied (relies on SDK's default).
  timeoutMs?: number;
  /**
   * 'none' (default): topics are `String()`-ed and `value` is the raw SDK
   * ScVal. 'native': `scValToNative` is applied to topics and value, encoded
   * JSON-safely (bigint as decimal string, bytes as hex), so consumers and
   * webhook receivers don't need stellar-sdk. Non-string topic segments are
   * JSON-encoded so `topic` stays `string[]`.
   */
  decode?: EventDecodeMode;
}

export type RpcEventType = 'contract' | 'system' | 'diagnostic' | 'all';

const EVENT_TYPES: readonly RpcEventType[] = ['contract', 'system', 'diagnostic', 'all'];

// Real Soroban RPC request/response shapes vary slightly by SDK minor version and
// require live network access to validate, so this class is intentionally kept out
// of the unit test suite (EventSource above is the seam the rest of the package
// depends on instead) and only needs to compile and behave reasonably. Request/
// response types are derived structurally from `server.getEvents` itself rather
// than naming the SDK's exported type, so this keeps compiling across minor
// SDK versions that rename or relocate that type.
type GetEventsRequest = Parameters<rpc.Server['getEvents']>[0];
type GetEventsResponse = Awaited<ReturnType<rpc.Server['getEvents']>>;

/**
 * {@link EventSource} implementation backed by the Soroban RPC `getEvents`
 * endpoint, with optional multi-endpoint failover, request timeouts, and
 * native ScVal decoding.
 *
 * @example
 * ```ts
 * const source = new RpcEventSource({
 *   rpcUrl: 'https://soroban-testnet.stellar.org',
 *   networkPassphrase: Networks.TESTNET,
 *   contractIds: ['CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM'],
 *   startLedger: 1000,
 * });
 * const { events, nextCursor } = await source.getEvents(undefined);
 * ```
 *
 * @example
 * ```ts
 * // Failover across two endpoints with native decoding.
 * const source = new RpcEventSource({
 *   rpcUrls: ['https://primary.example.org', 'https://fallback.example.org'],
 *   failoverAfter: 3,
 *   networkPassphrase: Networks.TESTNET,
 *   contractIds: ['CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM'],
 *   startLedger: 1000,
 *   decode: 'native',
 * });
 * ```
 */
export class RpcEventSource implements EventSource {
  private readonly options: RpcEventSourceOptions;
  private readonly rpcUrls: string[];
  private readonly servers = new Map<string, rpc.Server>();
  private readonly metrics: AnyMetricsRegistry;
  private startLedger: number | undefined;
  private urlIndex = 0;
  private consecutiveFailures = 0;
  private failedOverAt = 0;

  constructor(options: RpcEventSourceOptions) {
    this.rpcUrls = options.rpcUrls?.length ? options.rpcUrls : options.rpcUrl ? [options.rpcUrl] : [];
    if (this.rpcUrls.length === 0) {
      throw new Error('horizon-listener: RpcEventSource requires `rpcUrl` or a non-empty `rpcUrls` array');
    }
    this.metrics = options.metrics ?? new NoopMetricsRegistry();
    this.startLedger = options.startLedger;
    if (options.contractIds.length === 0) {
      throw new Error(
        'horizon-listener: RpcEventSource requires at least one contract ID (contractIds array cannot be empty)',
      );
    }
    if (options.topics !== undefined) {
      if (!Array.isArray(options.topics)) {
        throw new Error('horizon-listener: RpcEventSource `topics` must be an array of topic filters');
      }
      options.topics.forEach((filter, i) => {
        if (
          !Array.isArray(filter) ||
          filter.length === 0 ||
          filter.length > 4 ||
          !filter.every((segment) => typeof segment === 'string' && segment.length > 0)
        ) {
          throw new Error(
            `horizon-listener: RpcEventSource invalid topic filter at index ${i} ` +
              '(expected 1-4 non-empty string segments; use "*" as a wildcard)',
          );
        }
      });
    }
    if (options.eventType !== undefined && !EVENT_TYPES.includes(options.eventType)) {
      throw new Error(
        `horizon-listener: RpcEventSource invalid eventType "${String(options.eventType)}" ` +
          `(expected one of ${EVENT_TYPES.join(', ')})`,
      );
    }
    this.options = options;
  }

  /**
   * Builds the `filters` array sent with every getEvents request.
   *
   * @returns A single-element array describing the contract IDs, event type,
   *   and (if configured) topic filters.
   *
   * @example
   * ```ts
   * const source = new RpcEventSource({
   *   rpcUrl: 'https://soroban-testnet.stellar.org',
   *   networkPassphrase: Networks.TESTNET,
   *   contractIds: ['CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM'],
   * });
   * const filters = source.buildFilters();
   * // => [{ contractIds: ['C…'], type: 'contract' }]
   * ```
   */
  buildFilters(): Record<string, unknown>[] {
    const eventType = this.options.eventType ?? 'contract';
    const filter: Record<string, unknown> = { contractIds: this.options.contractIds };
    if (eventType !== 'all') filter.type = eventType;
    if (this.options.topics && this.options.topics.length > 0) {
      filter.topics = this.options.topics;
    }
    return [filter];
  }

  private getServer(): rpc.Server {
    const url = this.activeRpcUrl;
    let server = this.servers.get(url);
    if (!server) {
      server = new rpc.Server(url, { allowHttp: url.startsWith('http://') });
      this.servers.set(url, server);
    }
    return server;
  }

  private switchTo(index: number): void {
    const from = this.activeRpcUrl;
    this.urlIndex = index;
    this.consecutiveFailures = 0;
    this.metrics.counter.inc('rpc_failover', 'success');
    this.options.onFailover?.(from, this.activeRpcUrl);
  }

  /**
   * Fetches the next page of contract events from the active RPC endpoint,
   * rotating to the next URL on repeated failures.
   *
   * @param cursor - Cursor from a previous `nextCursor`, or `undefined` for the
   *   first call (requires `startLedger` to have been configured).
   * @returns The decoded events, the cursor to resume from, and optionally the
   *   latest ledger known to the RPC node.
   * @throws If called without a cursor before `startLedger` was configured, or
   *   if the request exceeds the configured `timeoutMs`.
   *
   * @example
   * ```ts
   * const source = new RpcEventSource({
   *   rpcUrl: 'https://soroban-testnet.stellar.org',
   *   networkPassphrase: Networks.TESTNET,
   *   contractIds: ['CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM'],
   *   startLedger: 1000,
   * });
   * let cursor: string | undefined;
   * const page = await source.getEvents(cursor);
   * cursor = page.nextCursor;
   * ```
   */
  async getEvents(
    cursor: string | undefined,
  ): Promise<{ events: RawContractEvent[]; nextCursor: string; latestLedger?: number }> {
    if (!cursor && this.options.startLedger == null) {
      throw new Error(
        'horizon-listener: RpcEventSource requires `startLedger` for the first cursor-less ' +
          "getEvents call. Pass a recent ledger within the RPC node's event retention window " +
          '(commonly ~24h / 17,280 ledgers); see the horizon-listener README.',
      );
    }

    const server = this.getServer();

    const request = (
      cursor
        ? {
            cursor,
            filters: this.buildFilters(),
          }
        : {
            startLedger: this.options.startLedger,
            filters: this.buildFilters(),
          }
    ) as GetEventsRequest;

    const getEventsPromise = server.getEvents(request);

    const response: GetEventsResponse = this.options.timeoutMs
      ? await Promise.race([
          getEventsPromise,
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`RPC getEvents timeout after ${this.options.timeoutMs}ms`)),
              this.options.timeoutMs,
            ),
          ),
        ])
      : await getEventsPromise;

    const rawEvents = (response as unknown as { events?: unknown[] }).events ?? [];

    const events: RawContractEvent[] = rawEvents.map((rawEvent) => {
      const event = rawEvent as {
        id: string;
        contractId: string;
        ledger: number;
        topic?: unknown[];
        value: unknown;
      };
      const native = this.options.decode === 'native';
      return {
        id: event.id,
        contractId: event.contractId,
        ledger: event.ledger,
        topic: (event.topic ?? []).map((topicItem) =>
          native ? decodeTopicToString(topicItem) : String(topicItem),
        ),
        value: native ? decodeScValToJson(event.value) : event.value,
      };
    });

    const responseCursor = (response as unknown as { cursor?: string }).cursor;
    const nextCursor =
      responseCursor ?? (events.length > 0 ? events[events.length - 1].id : (cursor ?? ''));

    const latestLedger = (response as unknown as { latestLedger?: number }).latestLedger;

    return { events, nextCursor, latestLedger };
  }
}
