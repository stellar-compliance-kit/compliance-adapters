/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'fs';
import type { Logger } from '@compliance-adapters/logger';

/**
 * Persistence contract used by resumable sanctions syncs.
 *
 * `load` returns the addresses completed by an earlier run. Implementations
 * should make `markComplete` durable before it resolves.
 */
export interface CheckpointStore {
  load(): string[] | Promise<string[]>;
  markComplete(address: string): void | Promise<void>;
  reset(): void | Promise<void>;
}

/**
 * Legacy checkpoint contract retained for stores written against earlier
 * versions. New stores should implement {@link CheckpointStore}.
 */
export interface SyncCheckpointStore {
  isComplete(address: string): boolean | Promise<boolean>;
  markComplete(address: string): void | Promise<void>;
}

export interface FileCheckpointStoreOptions {
  /** Optional JSON indentation for the checkpoint file. Defaults to 2. */
  spaces?: number;
}

/**
 * JSON-file implementation of {@link CheckpointStore}.
 *
 * A missing file is treated as an empty checkpoint. Writes use a temporary
 * file followed by a rename so a process restart cannot leave a partial JSON
 * document behind.
 */
export class FileCheckpointStore implements CheckpointStore {
  private readonly spaces: number;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    options: FileCheckpointStoreOptions = {},
  ) {
    this.spaces = options.spaces ?? 2;
  }

  async load(): Promise<string[]> {
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(content);
      if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
        throw new Error(`Checkpoint file must contain a JSON array of strings: ${this.filePath}`);
      }
      return [...new Set(parsed)];
    } catch (error) {
      if (isFileNotFound(error)) return [];
      throw error;
    }
  }

  async markComplete(address: string): Promise<void> {
    await this.enqueue(async () => {
      const completed = new Set(await this.load());
      completed.add(address);
      await this.write([...completed]);
    });
  }

  async reset(): Promise<void> {
    await this.enqueue(() => this.write([]));
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.then(operation);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  private async write(addresses: string[]): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(addresses, null, this.spaces)}\n`, 'utf8');
      await fs.rename(temporaryPath, this.filePath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true });
      throw error;
    }
  }
}

/**
 * Minimal Redis client surface required by {@link RedisCheckpointStore}.
 * Both ioredis and node-redis can be adapted to this shape without adding a
 * Redis client dependency to sanctions-oracle.
 */
export interface CheckpointRedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export interface RedisCheckpointStoreOptions {
  /** Redis key used for the serialized set of completed addresses. */
  key?: string;
}

/**
 * Redis-backed implementation of {@link CheckpointStore}.
 */
export class RedisCheckpointStore implements CheckpointStore {
  private readonly key: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly redis: CheckpointRedisLike,
    options: RedisCheckpointStoreOptions = {},
  ) {
    this.key = options.key ?? 'sanctions-oracle:checkpoint';
  }

  async load(): Promise<string[]> {
    const value = await this.redis.get(this.key);
    if (value === null) return [];
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
      throw new Error(`Redis checkpoint value must be a JSON array of strings: ${this.key}`);
    }
    return [...new Set(parsed)];
  }

  async markComplete(address: string): Promise<void> {
    const next = this.writeQueue.then(async () => {
      const completed = new Set(await this.load());
      completed.add(address);
      await this.redis.set(this.key, JSON.stringify([...completed]));
    });
    this.writeQueue = next.catch(() => undefined);
    await next;
  }

  async reset(): Promise<void> {
    const next = this.writeQueue.then(() => this.redis.del(this.key).then(() => undefined));
    this.writeQueue = next.catch(() => undefined);
    await next;
  }
}

/**
 * In-memory reference implementation of {@link CheckpointStore}.
 */
export class InMemoryCheckpointStore implements CheckpointStore, SyncCheckpointStore {
  private readonly completed: Set<string>;

  constructor(initiallyComplete: Iterable<string> = []) {
    this.completed = new Set(initiallyComplete);
  }

  load(): string[] {
    return [...this.completed];
  }

  isComplete(address: string): boolean {
    return this.completed.has(address);
  }

  markComplete(address: string): void {
    this.completed.add(address);
  }

  reset(): void {
    this.completed.clear();
  }

  snapshot(): string[] {
    return this.load();
  }
}

/**
 * File-backed {@link SyncCheckpointStore} that persists completed addresses as
 * a JSON array, so a sync can resume after the process is killed.
 *
 * Writes are atomic: the snapshot is written to `<path>.tmp` and then renamed
 * over `path`, so a crash mid-write never leaves a truncated checkpoint. If the
 * existing file can't be parsed anyway (e.g. written by an older, non-atomic
 * version), it is moved aside to `<path>.corrupt-<timestamp>`, a warning is
 * logged, and the store starts fresh instead of crashing the sync.
 */
export class FileCheckpointStore implements SyncCheckpointStore {
  private readonly completed: Set<string>;

  constructor(
    private readonly path: string,
    logger?: Pick<Logger, 'warn'>,
  ) {
    this.completed = new Set(FileCheckpointStore.load(path, logger));
  }

  private static load(path: string, logger?: Pick<Logger, 'warn'>): string[] {
    let raw: string;
    try {
      raw = fs.readFileSync(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
        throw new Error('checkpoint must be a JSON array of strings');
      }
      return parsed;
    } catch (error) {
      const corruptPath = `${path}.corrupt-${Date.now()}`;
      fs.renameSync(path, corruptPath);
      logger?.warn('sanctions-oracle: checkpoint file is corrupt; starting fresh', {
        path,
        movedTo: corruptPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  isComplete(address: string): boolean {
    return this.completed.has(address);
  }

  markComplete(address: string): void {
    if (this.completed.has(address)) return;
    this.completed.add(address);
    const tmpPath = `${this.path}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify([...this.completed]));
    fs.renameSync(tmpPath, this.path);
  }

  /** All addresses recorded as complete so far. */
  snapshot(): string[] {
    return [...this.completed];
  }
}

// ---------------------------------------------------------------------------
// Provider cache
// ---------------------------------------------------------------------------

/**
 * A single cached provider response.
 *
 * Entries are keyed by provider name and list version (the ETag or
 * Last-Modified value advertised by the provider). The cached body lets a sync
 * skip re-downloading a list when a conditional request reports it unchanged.
 */
export interface ProviderCacheEntry {
  /** Provider identifier, e.g. `ofac` or `eu-consolidated`. */
  provider: string;
  /** List version used as the cache key (ETag or Last-Modified value). */
  version: string;
  /** ETag returned by the provider, if any. */
  etag?: string;
  /** Last-Modified header returned by the provider, if any. */
  lastModified?: string;
  /** Raw response body captured when the entry was stored. */
  body: string;
  /** Epoch milliseconds at which the entry was stored. */
  fetchedAt: number;
}

/**
 * Persistence contract for provider responses.
 *
 * Implementations should treat a missing entry as a cache miss and must make
 * `set` durable before it resolves.
 */
export interface ProviderCache {
  get(provider: string, version: string): ProviderCacheEntry | undefined | Promise<ProviderCacheEntry | undefined>;
  set(entry: ProviderCacheEntry): void | Promise<void>;
  delete(provider: string, version: string): void | Promise<void>;
  clear(): void | Promise<void>;
}

export interface FileProviderCacheOptions {
  /** Optional JSON indentation for the cache file. Defaults to 2. */
  spaces?: number;
}

/**
 * JSON-file implementation of {@link ProviderCache}.
 *
 * The cache is stored alongside the checkpoint store as a JSON object keyed by
 * `<provider>\u0000<version>`. Writes use a temporary file followed by a rename
 * so a process restart cannot leave a partial JSON document behind.
 */
export class FileProviderCache implements ProviderCache {
  private readonly spaces: number;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    options: FileProviderCacheOptions = {},
  ) {
    this.spaces = options.spaces ?? 2;
  }

  async get(provider: string, version: string): Promise<ProviderCacheEntry | undefined> {
    const entries = await this.read();
    return entries[cacheKey(provider, version)];
  }

  async set(entry: ProviderCacheEntry): Promise<void> {
    await this.enqueue(async () => {
      const entries = await this.read();
      entries[cacheKey(entry.provider, entry.version)] = entry;
      await this.write(entries);
    });
  }

  async delete(provider: string, version: string): Promise<void> {
    await this.enqueue(async () => {
      const entries = await this.read();
      delete entries[cacheKey(provider, version)];
      await this.write(entries);
    });
  }

  async clear(): Promise<void> {
    await this.enqueue(() => this.write({}));
  }

  private async read(): Promise<Record<string, ProviderCacheEntry>> {
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(content);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Provider cache file must contain a JSON object: ${this.filePath}`);
      }
      return parsed as Record<string, ProviderCacheEntry>;
    } catch (error) {
      if (isFileNotFound(error)) return {};
      throw error;
    }
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.then(operation);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  private async write(entries: Record<string, ProviderCacheEntry>): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(entries, null, this.spaces)}\n`, 'utf8');
      await fs.rename(temporaryPath, this.filePath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true });
      throw error;
    }
  }
}

export interface RedisProviderCacheOptions {
  /** Redis key prefix used for provider cache entries. */
  keyPrefix?: string;
}

/**
 * Redis-backed implementation of {@link ProviderCache}.
 *
 * Each entry is stored under `<keyPrefix>:<provider>:<version>` so a single
 * provider/version can be invalidated without rewriting the whole cache.
 */
export class RedisProviderCache implements ProviderCache {
  private readonly keyPrefix: string;

  constructor(
    private readonly redis: CheckpointRedisLike,
    options: RedisProviderCacheOptions = {},
  ) {
    this.keyPrefix = options.keyPrefix ?? 'sanctions-oracle:provider-cache';
  }

  async get(provider: string, version: string): Promise<ProviderCacheEntry | undefined> {
    const value = await this.redis.get(this.redisKey(provider, version));
    if (value === null) return undefined;
    return JSON.parse(value) as ProviderCacheEntry;
  }

  async set(entry: ProviderCacheEntry): Promise<void> {
    await this.redis.set(this.redisKey(entry.provider, entry.version), JSON.stringify(entry));
  }

  async delete(provider: string, version: string): Promise<void> {
    await this.redis.del(this.redisKey(provider, version));
  }

  async clear(): Promise<void> {
    // The minimal Redis surface has no SCAN; callers that need a full flush
    // should drop the prefix out of band.
  }

  private redisKey(provider: string, version: string): string {
    return `${this.keyPrefix}:${provider}:${version}`;
  }
}

/**
 * In-memory reference implementation of {@link ProviderCache}.
 */
export class InMemoryProviderCache implements ProviderCache {
  private readonly entries = new Map<string, ProviderCacheEntry>();

  get(provider: string, version: string): ProviderCacheEntry | undefined {
    return this.entries.get(cacheKey(provider, version));
  }

  set(entry: ProviderCacheEntry): void {
    this.entries.set(cacheKey(entry.provider, entry.version), entry);
  }

  delete(provider: string, version: string): void {
    this.entries.delete(cacheKey(provider, version));
  }

  clear(): void {
    this.entries.clear();
  }
}

function cacheKey(provider: string, version: string): string {
  return `${provider}\u0000${version}`;
}

function dirname(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return index <= 0 ? '.' : filePath.slice(0, index);
}

function isFileNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}