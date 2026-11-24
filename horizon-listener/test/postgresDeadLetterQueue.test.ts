/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { PostgresDeadLetterQueue, type PostgresClient } from '../src/postgresDeadLetterQueue';
import { MetricsRegistry } from '../src/metrics';

function event(id: string) {
  return { id, contractId: 'C', ledger: 1, timestamp: 't', type: 'ev', data: {} } as never;
}

/** Small in-memory stand-in for a `pg` Client/Pool. */
class FakePgClient implements PostgresClient {
  rows: Record<string, unknown>[] = [];
  readonly statements: string[] = [];

  async query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number }> {
    this.statements.push(text);
    if (text.includes('CREATE TABLE') || text.includes('CREATE INDEX')) return { rows: [] };
    if (text.includes('INSERT INTO')) {
      const [id, rawEvent, rawError, timestamp] = values as string[];
      if (!this.rows.some((row) => row.event_id === id)) {
        this.rows.push({ event_id: id, event: rawEvent, error: rawError, timestamp });
      }
      return { rows: [] };
    }
    if (text.startsWith('SELECT COUNT')) return { rows: [{ count: this.rows.length }] };
    if (text.startsWith('SELECT event')) {
      return { rows: [...this.rows].sort((a, b) => String(a.event_id).localeCompare(String(b.event_id))) };
    }
    if (text.startsWith('DELETE') && values) {
      const before = this.rows.length;
      this.rows = this.rows.filter((row) => row.event_id !== values[0]);
      return { rows: [], rowCount: before - this.rows.length };
    }
    this.rows = [];
    return { rows: [], rowCount: 0 };
  }
}

describe('PostgresDeadLetterQueue (#1008)', () => {
  it('persists entries across instances and supports replay', async () => {
    const client = new FakePgClient();
    const first = new PostgresDeadLetterQueue({ client });
    await first.enqueue(event('a'), new Error('boom'));
    await first.enqueue(event('b'), new Error('boom'));

    const second = new PostgresDeadLetterQueue({ client });
    expect((await second.getAll()).map((e) => e.event.id)).toEqual(['a', 'b']);

    const delivered: string[] = [];
    const result = await second.replay(async (e) => {
      if ((e as { id: string }).id === 'b') throw new Error('down');
      delivered.push((e as { id: string }).id);
    });
    expect(result).toEqual({ delivered: 1, failed: 1, attempted: 2 });
    expect(delivered).toEqual(['a']);
    expect((await second.getAll()).map((e) => e.event.id)).toEqual(['b']);
    expect(await second.remove('missing')).toBe(false);
    await second.clear();
    expect(await second.getAll()).toEqual([]);
  });

  it('publishes queue size and validates table names', async () => {
    const metrics = new MetricsRegistry();
    const client = new FakePgClient();
    const queue = new PostgresDeadLetterQueue({ client, metrics, tableName: 'public.dlq' });
    await queue.enqueue(event('a'), new Error('x'));
    expect(metrics.getDlqSize()).toBe(1);
    expect(() => new PostgresDeadLetterQueue({ client, tableName: 'dlq; DROP TABLE x' })).toThrow(
      /Invalid Postgres DLQ table name/,
    );
  });
});
