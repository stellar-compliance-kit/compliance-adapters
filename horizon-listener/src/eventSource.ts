/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { rpc } from '@stellar/stellar-sdk';

export interface RawContractEvent {
  id: string;
  contractId: string;
  ledger: number;
  topic: string[];
  value: unknown;
}

export interface EventSource {
  getEvents(
    cursor: string | undefined,
  ): Promise<{ events: RawContractEvent[]; nextCursor: string }>;
}

export interface RpcEventSourceOptions {
  rpcUrl: string;
  networkPassphrase: string;
  contractIds: string[];
  // Soroban RPC requires a starting ledger for the very first (cursor-less)
  // call; callers should pass a recent ledger they know is within the RPC's
  // retention window. Left undefined, the RPC call will surface its own error.
  startLedger?: number;
}

// Real Soroban RPC request/response shapes vary slightly by SDK minor version and
// require live network access to validate, so this class is intentionally kept out
// of the unit test suite (EventSource above is the seam the rest of the package
// depends on instead) and only needs to compile and behave reasonably. Request/
// response types are derived structurally from `server.getEvents` itself rather
// than naming the SDK's exported type, so this keeps compiling across minor
// SDK versions that rename or relocate that type.
type GetEventsRequest = Parameters<rpc.Server['getEvents']>[0];
type GetEventsResponse = Awaited<ReturnType<rpc.Server['getEvents']>>;

export class RpcEventSource implements EventSource {
  private readonly options: RpcEventSourceOptions;
  private server: rpc.Server | undefined;

  constructor(options: RpcEventSourceOptions) {
    this.options = options;
  }

  private getServer(): rpc.Server {
    if (!this.server) {
      this.server = new rpc.Server(this.options.rpcUrl);
    }
    return this.server;
  }

  async getEvents(
    cursor: string | undefined,
  ): Promise<{ events: RawContractEvent[]; nextCursor: string }> {
    const server = this.getServer();

    const request = (
      cursor
        ? {
            cursor,
            filters: [{ type: 'contract', contractIds: this.options.contractIds }],
          }
        : {
            startLedger: this.options.startLedger ?? 0,
            filters: [{ type: 'contract', contractIds: this.options.contractIds }],
          }
    ) as GetEventsRequest;

    const response: GetEventsResponse = await server.getEvents(request);
    const rawEvents = (response as unknown as { events?: unknown[] }).events ?? [];

    const events: RawContractEvent[] = rawEvents.map((rawEvent) => {
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
    });

    const responseCursor = (response as unknown as { cursor?: string }).cursor;
    const nextCursor =
      responseCursor ?? (events.length > 0 ? events[events.length - 1].id : (cursor ?? ''));

    return { events, nextCursor };
  }
}
