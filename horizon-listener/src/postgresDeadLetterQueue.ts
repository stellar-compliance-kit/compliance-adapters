/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * @file postgresDeadLetterQueue.ts
 *
 * Durable, Postgres-backed dead-letter queue for ephemeral containers.
 * Any `pg` `Client`/`Pool` satisfies {@link PostgresClient}; the dependency is
 * injected so this package does not force a particular driver or connection
 * strategy on consumers.
 */

import type { RawContractEvent } from './eventSource';
import {
  replayDeadLetterQueue,
  type DlqSizeMetrics,
  type DeadLetterEvent,
  type DeadLetterQueue,
  type ReplayDeadLetterQueueResult,
} from './deadLetterQueue';

/** Structural subset of a `node-postgres` Client/Pool used by this queue. */
export interface PostgresClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface PostgresDeadLetterQueueOptions {
  /** An initialized `pg` Client or Pool. */
  client: PostgresClient;
  /** Table name (default `dead_letter_queue`). May include a schema prefix. */
  tableName?: string;
  /** Optional metrics registry used to publish the queue depth. */
  metrics?: DlqSizeMetrics;
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(value);
}

function toEntry(row: Record<string, unknown>): DeadLetterEvent {
  return {
    event: typeof row.event === 'string' ? JSON.parse(row.event) : (row.event as RawContractEvent),
    error:
      typeof row.error === 'string'
        ? JSON.parse(row.error)
        : (row.error as { message: string; stack?: string }),
    timestamp: String(row.timestamp),
  };
}

/**
 * Postgres-backed DLQ. Entries survive container restarts and can be replayed
 * via {@link replay} (or the generic `replayDeadLetterQueue` helper).
 */
export class PostgresDeadLetterQueue implements DeadLetterQueue {
  private readonly client: PostgresClient;
  private readonly table: string;
  private readonly metrics?: DlqSizeMetrics;
  private initialized?: Promise<void>;

  constructor(options: PostgresDeadLetterQueueOptions) {
    if (!isIdentifier(options.tableName ?? 'dead_letter_queue')) {
      throw new Error(`Invalid Postgres DLQ table name: ${options.tableName}`);
    }
    this.client = options.client;
    this.table = options.tableName ?? 'dead_letter_queue';
    this.metrics = options.metrics;
  }

  /** Creates the table if needed. Safe to call more than once. */
  async initialize(): Promise<void> {
    this.initialized ??= (async () => {
      await this.client.query(`
        CREATE TABLE IF NOT EXISTS ${this.table} (
          event_id TEXT PRIMARY KEY,
          event JSONB NOT NULL,
          error JSONB NOT NULL,
          timestamp TEXT NOT NULL,
          enqueued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await this.client.query(
        `CREATE INDEX IF NOT EXISTS ${this.table}_enqueued_at_idx ON ${this.table} (enqueued_at)`,
      );
    })();
    return this.initialized;
  }

  async enqueue(event: RawContractEvent, error: unknown): Promise<void> {
    await this.initialize();
    const err = error instanceof Error ? error : new Error(String(error));
    const entry: DeadLetterEvent = {
      event,
      error: { message: err.message, stack: err.stack },
      timestamp: new Date().toISOString(),
    };
    await this.client.query(
      `INSERT INTO ${this.table} (event_id, event, error, timestamp)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (event_id) DO NOTHING`,
      [event.id, JSON.stringify(event), JSON.stringify(entry.error), entry.timestamp],
    );
    this.recordSize();
  }

  async getAll(): Promise<DeadLetterEvent[]> {
    await this.initialize();
    const result = await this.client.query(
      `SELECT event, error, timestamp FROM ${this.table} ORDER BY enqueued_at ASC, event_id ASC`,
    );
    return result.rows.map((row) => toEntry(row as Record<string, unknown>));
  }

  async remove(eventId: string): Promise<boolean> {
    await this.initialize();
    const result = await this.client.query(
      `DELETE FROM ${this.table} WHERE event_id = $1`,
      [eventId],
    );
    this.recordSize();
    return (result as { rowCount?: number }).rowCount !== 0;
  }

  async clear(): Promise<void> {
    await this.initialize();
    await this.client.query(`DELETE FROM ${this.table}`);
    this.recordSize();
  }

  /** Redelivers entries oldest-first, deleting only those delivered successfully. */
  async replay(
    send: (event: RawContractEvent) => Promise<void>,
    options: { dryRun?: boolean; limit?: number } = {},
  ): Promise<ReplayDeadLetterQueueResult> {
    await this.initialize();
    return replayDeadLetterQueue({ queue: this, send, ...options });
  }

  private async recordSize(): Promise<void> {
    if (!this.metrics) return;
    try {
      const result = await this.client.query(`SELECT COUNT(*) AS count FROM ${this.table}`);
      const row = result.rows[0] as { count?: string | number } | undefined;
      this.metrics.setDlqSize(Number(row?.count ?? 0));
    } catch {
      // Metrics must never break dead-letter persistence.
    }
  }
}
