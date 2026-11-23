import { EventEmitter } from 'events';
import * as http from 'http';
import { Horizon, Server } from '@stellar/stellar-sdk';

export interface HorizonListenerConfig {
  horizonUrl: string;
  contracts: string[];
  /**
   * Optional topic filter. Only events whose first topic symbol matches one of
   * these entries are forwarded. An entry matches exactly when it equals the
   * symbol, or as a prefix when it ends with `*` (e.g. `transfer*`).
   */
  topicFilter?: string[];
  pollIntervalMs?: number;
  cursor?: string;
  /**
   * Optional health server. Disabled unless `healthPort` is set. When enabled,
   * `GET /healthz` reports process liveness and `GET /readyz` reports readiness
   * (200 only when listener lag is under `readyLagThresholdMs`).
   */
  healthPort?: number;
  healthHost?: string;
  /** Max acceptable lag (ms) for `/readyz` to report ready. Defaults to 30000. */
  readyLagThresholdMs?: number;
}

export interface ContractEvent {
  contractId: string;
  topics: string[];
  value: unknown;
  ledger: number;
  txHash: string;
  pagingToken: string;
}

/**
 * Returns true when the event's first topic matches the configured filter.
 * A filter entry matches exactly when it equals the symbol, or as a prefix
 * when it ends with `*`. An empty/undefined filter forwards everything.
 */
export function matchesTopicFilter(
  topics: string[],
  filter?: string[],
): boolean {
  if (!filter || filter.length === 0) {
    return true;
  }
  const symbol = topics[0];
  if (symbol === undefined) {
    return false;
  }
  return filter.some((entry) => {
    if (entry.endsWith('*')) {
      return symbol.startsWith(entry.slice(0, -1));
    }
    return symbol === entry;
  });
}

export class HorizonListener extends EventEmitter {
  private readonly config: Required<Pick<HorizonListenerConfig, 'horizonUrl' | 'contracts' | 'pollIntervalMs'>> &
    HorizonListenerConfig;
  private server: Server;
  private cursor?: string;
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastPollAt?: number;
  private healthServer?: http.Server;

  constructor(config: HorizonListenerConfig) {
    super();
    this.config = {
      pollIntervalMs: 5000,
      ...config,
    };
    this.server = new Server(this.config.horizonUrl);
    this.cursor = config.cursor;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.startHealthServer();
    void this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.stopHealthServer();
  }

  private startHealthServer(): void {
    if (this.config.healthPort === undefined || this.healthServer) {
      return;
    }
    this.healthServer = http.createServer((req, res) => {
      const url = req.url ?? '';
      if (req.method !== 'GET') {
        res.statusCode = 405;
        res.end();
        return;
      }
      if (url === '/healthz') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      if (url === '/readyz') {
        const ready = this.isReady();
        res.statusCode = ready ? 200 : 503;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ status: ready ? 'ready' : 'not_ready' }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    this.healthServer.listen(
      this.config.healthPort,
      this.config.healthHost,
    );
  }

  private stopHealthServer(): void {
    if (this.healthServer) {
      this.healthServer.close();
      this.healthServer = undefined;
    }
  }

  private isReady(): boolean {
    if (!this.running || this.lastPollAt === undefined) {
      return false;
    }
    const threshold = this.config.readyLagThresholdMs ?? 30000;
    return Date.now() - this.lastPollAt <= threshold;
  }

  private async poll(): Promise<void> {
    if (!this.running) {
      return;
    }
    try {
      await this.fetchEvents();
      this.lastPollAt = Date.now();
    } catch (err) {
      this.emit('error', err);
    } finally {
      if (this.running) {
        this.timer = setTimeout(() => void this.poll(), this.config.pollIntervalMs);
      }
    }
  }

  private async fetchEvents(): Promise<void> {
    for (const contractId of this.config.contracts) {
      const builder = this.server
        .events()
        .forContract(contractId)
        .order('asc')
        .limit(200);
      if (this.cursor) {
        builder.cursor(this.cursor);
      }
      const response = await builder.call();
      for (const raw of response.records) {
        const event = this.toContractEvent(raw);
        this.cursor = event.pagingToken;
        if (!matchesTopicFilter(event.topics, this.config.topicFilter)) {
          continue;
        }
        this.emit('event', event);
      }
    }
  }

  private toContractEvent(raw: Horizon.ServerApi.EventRecord): ContractEvent {
    return {
      contractId: raw.contractId ?? '',
      topics: (raw.topic ?? []).map((t) => String(t)),
      value: raw.value,
      ledger: raw.ledger,
      txHash: raw.txHash,
      pagingToken: raw.pagingToken,
    };
  }
}
