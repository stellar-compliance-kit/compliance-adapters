/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import {
  DeadLetterQueueFullError,
  FileDeadLetterQueue,
  InMemoryDeadLetterQueue,
} from '../src/deadLetterQueue';
import { MetricsRegistry } from '../src/metrics';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function event(id: string) {
  return { id, contractId: 'C', ledger: 1, timestamp: 't', type: 'ev', data: {} } as never;
}

describe('DLQ bounds and size metric (#1007)', () => {
  it('evicts oldest entries when maxEntries is exceeded', async () => {
    const queue = new InMemoryDeadLetterQueue({ maxEntries: 2 });
    for (const id of ['a', 'b', 'c']) await queue.enqueue(event(id), new Error('x'));
    expect(queue.getAll().map((e) => e.event.id)).toEqual(['b', 'c']);
  });

  it('evicts oldest entries when maxBytes is exceeded', async () => {
    const queue = new InMemoryDeadLetterQueue({ maxBytes: 700 });
    for (const id of ['a', 'b', 'c', 'd']) await queue.enqueue(event(id), new Error('x'));
    expect(queue.size()).toBeLessThan(4);
    expect(queue.getAll()[queue.size() - 1].event.id).toBe('d');
  });

  it('can refuse new entries instead of evicting', async () => {
    const queue = new InMemoryDeadLetterQueue({ maxEntries: 1, overflow: 'refuse' });
    await queue.enqueue(event('a'), new Error('x'));
    await expect(queue.enqueue(event('b'), new Error('x'))).rejects.toBeInstanceOf(
      DeadLetterQueueFullError,
    );
    expect(queue.getAll().map((e) => e.event.id)).toEqual(['a']);
  });

  it('publishes the dlq_size gauge and keeps file storage in sync', async () => {
    const metrics = new MetricsRegistry();
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dlq-cap-')), 'dlq.jsonl');
    const queue = new FileDeadLetterQueue(file, { maxEntries: 2, metrics });
    await queue.enqueue(event('a'), new Error('x'));
    await queue.enqueue(event('b'), new Error('x'));
    await queue.enqueue(event('c'), new Error('x'));
    expect(metrics.getDlqSize()).toBe(2);
    expect(metrics.expose()).toContain('horizon_listener_dlq_size 2');
    expect(fs.readFileSync(file, 'utf-8').trim().split('\n')).toHaveLength(2);
    await queue.clear();
    expect(metrics.getDlqSize()).toBe(0);
  });
});
