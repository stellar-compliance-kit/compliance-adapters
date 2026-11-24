/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'fs';
import * as path from 'path';
import type { RawContractEvent } from './eventSource';

/** A failed event captured together with the error that caused the failure. */
export interface DeadLetterEvent {
  event: RawContractEvent;
  error: { message: string; stack?: string };
  /** ISO-8601 time at which the event was enqueued. */
  timestamp: string;
}

export interface DeadLetterQueue {
  /** Suitable as (or from within) `onEventFailure`. */
  enqueue(event: RawContractEvent, error: unknown): Promise<void>;
  /** Returns a copy of all stored entries in insertion order (may be async). */
  getAll(): DeadLetterEvent[] | Promise<DeadLetterEvent[]>;
  /** Removes the first entry for `eventId`; resolves `false` if none exists. */
  remove(eventId: string): Promise<boolean>;
  clear(): Promise<void>;
}

/** Minimal metrics surface needed to expose the current DLQ size. */
export interface DlqSizeMetrics {
  setDlqSize(size: number): void;
}

/** Bounds applied when new dead letters are enqueued. */
export interface DeadLetterQueueLimits {
  /** Maximum number of entries. Unlimited when omitted. */
  maxEntries?: number;
  /** Maximum total serialized bytes. Unlimited when omitted. */
  maxBytes?: number;
  /**
   * What to do when a new entry would exceed a limit: evict the oldest entry
   * (default) or reject the new entry with {@link DeadLetterQueueFullError}.
   */
  overflow?: 'evict-oldest' | 'refuse';
  /** Optional registry used to publish the `<prefix>_dlq_size` gauge. */
  metrics?: DlqSizeMetrics;
}

/** Thrown by bounded queues configured with `overflow: 'refuse'`. */
export class DeadLetterQueueFullError extends Error {
  constructor(message = 'dead-letter queue is full') {
    super(message);
    this.name = 'DeadLetterQueueFullError';
  }
}

function entryBytes(entry: DeadLetterEvent): number {
  return Buffer.byteLength(JSON.stringify(entry), 'utf-8');
}

function toEntry(event: RawContractEvent, error: unknown): DeadLetterEvent {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    event,
    error: { message: err.message, stack: err.stack },
    timestamp: new Date().toISOString(),
  };
}

export class InMemoryDeadLetterQueue implements DeadLetterQueue {
  protected entries: DeadLetterEvent[] = [];
  protected readonly limits: DeadLetterQueueLimits;

  constructor(limits: DeadLetterQueueLimits = {}) {
    this.limits = limits;
  }

  /** Current number of queued entries. */
  size(): number {
    return this.entries.length;
  }

  protected recordSize(): void {
    this.limits.metrics?.setDlqSize(this.entries.length);
  }

  /** Enforce configured bounds, evicting oldest entries when appropriate. */
  protected applyLimits(entry: DeadLetterEvent): boolean {
    const { maxEntries, maxBytes, overflow = 'evict-oldest' } = this.limits;
    const bytes = () => this.entries.reduce((sum, e) => sum + entryBytes(e), 0);
    const fits = () =>
      (maxEntries === undefined || this.entries.length < maxEntries) &&
      (maxBytes === undefined || bytes() + entryBytes(entry) <= maxBytes);
    if (fits()) return true;
    if (overflow === 'refuse') {
      throw new DeadLetterQueueFullError();
    }
    while (this.entries.length > 0 && !fits()) {
      this.entries.shift();
    }
    return fits();
  }

  async enqueue(event: RawContractEvent, error: unknown): Promise<void> {
    const entry = toEntry(event, error);
    if (!this.applyLimits(entry)) return;
    this.entries.push(entry);
    this.recordSize();
  }

  getAll(): DeadLetterEvent[] {
    return [...this.entries];
  }

  async remove(eventId: string): Promise<boolean> {
    const index = this.entries.findIndex((entry) => entry.event.id === eventId);
    if (index === -1) return false;
    this.entries.splice(index, 1);
    this.recordSize();
    return true;
  }

  async clear(): Promise<void> {
    this.entries = [];
    this.recordSize();
  }
}

/**
 * JSON-lines file-backed queue. Existing entries are loaded on construction so
 * they survive restarts. All disk writes are synchronous, so concurrent
 * `enqueue` calls cannot interleave or lose data.
 */
export class FileDeadLetterQueue extends InMemoryDeadLetterQueue {
  constructor(
    private readonly filePath: string,
    limits: DeadLetterQueueLimits = {},
  ) {
    super(limits);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (fs.existsSync(filePath)) {
      this.entries = fs
        .readFileSync(filePath, 'utf-8')
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as DeadLetterEvent);
    } else {
      fs.writeFileSync(filePath, '');
    }
    this.recordSize();
  }

  getFilePath(): string {
    return this.filePath;
  }

  override async enqueue(event: RawContractEvent, error: unknown): Promise<void> {
    const entry = toEntry(event, error);
    if (!this.applyLimits(entry)) return;
    this.entries.push(entry);
    // Eviction rewrites the whole file; a plain append would resurrect
    // entries that were just dropped from memory.
    this.persist();
    this.recordSize();
  }

  override async remove(eventId: string): Promise<boolean> {
    const removed = await super.remove(eventId);
    if (removed) this.persist();
    return removed;
  }

  override async clear(): Promise<void> {
    await super.clear();
    this.persist();
  }

  private persist(): void {
    fs.writeFileSync(
      this.filePath,
      this.entries.map((entry) => JSON.stringify(entry) + '\n').join(''),
    );
  }
}

/** Options for {@link replayDeadLetterQueue}. */
export interface ReplayDeadLetterQueueOptions {
  queue: DeadLetterQueue;
  /** Redeliver one event; must resolve on success and reject on failure. */
  send: (event: RawContractEvent) => Promise<void>;
  /** When true, entries are counted but never removed. */
  dryRun?: boolean;
  /** Maximum entries to attempt (oldest first). Defaults to all. */
  limit?: number;
}

/** Outcome of {@link replayDeadLetterQueue}. */
export interface ReplayDeadLetterQueueResult {
  delivered: number;
  failed: number;
  attempted: number;
}

/**
 * Replays DLQ entries (oldest first) via `send`, removing each entry only
 * after a successful redelivery. Failures remain queued for a later retry.
 */
export async function replayDeadLetterQueue(
  options: ReplayDeadLetterQueueOptions,
): Promise<ReplayDeadLetterQueueResult> {
  const { queue, send, dryRun = false, limit } = options;
  const all = await queue.getAll();
  const entries = all.slice(0, limit ?? Number.MAX_SAFE_INTEGER);
  let delivered = 0;
  let failed = 0;
  for (const entry of entries) {
    try {
      await send(entry.event);
      delivered++;
      if (!dryRun) await queue.remove(entry.event.id);
    } catch {
      failed++;
    }
  }
  return { delivered, failed, attempted: entries.length };
}
