/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

/**
 * Pluggable remote audit sinks for sanctions-oracle.
 *
 * Audit events are immutable objects in S3/GCS, one object per event, so
 * ephemeral containers no longer lose JSONL data on the local disk. The
 * cloud SDKs are loaded lazily; clients can be injected for testing with
 * mocks (no credentials or network access needed).
 */

import { randomUUID } from 'crypto';
import type { AuditLogEntry, AuditLogger } from './sync';

/** Minimal S3 client surface used by the audit sink (satisfied by S3Client). */
export interface S3PutObjectClient {
  send(command: unknown): Promise<unknown>;
}

/** Minimal GCS surface used by the audit sink (satisfied by Storage). */
export interface GcsStorageClient {
  bucket(name: string): { file(name: string): { save(data: string): Promise<void> } };
}

export interface S3AuditSinkOptions {
  bucket: string;
  /** Key prefix, e.g. `audit/sanctions`. */
  prefix?: string;
  /** Inject an S3-compatible client (tests/mocks). */
  client?: S3PutObjectClient;
}

export interface GcsAuditSinkOptions {
  bucket: string;
  /** Object name prefix, e.g. `audit/sanctions`. */
  prefix?: string;
  /** Inject a GCS-compatible client (tests/mocks). */
  client?: GcsStorageClient;
}

function objectKey(prefix: string | undefined, entry: AuditLogEntry): string {
  const date = new Date(entry.timestamp);
  const day = Number.isNaN(date.getTime())
    ? new Date().toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10);
  const [year, month, dayOfMonth] = day.split('-');
  const safeTx = entry.txHash.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  const name = `${Date.now()}-${safeTx}-${randomUUID()}.json`;
  return [prefix?.replace(/^\/+|\/+$/g, ''), year, month, dayOfMonth, name]
    .filter(Boolean)
    .join('/');
}

/** Serializes writes so audit events are never partially interleaved. */
function serialize(write: (entry: AuditLogEntry) => Promise<void>): AuditLogger {
  let queue: Promise<void> = Promise.resolve();
  return (entry: AuditLogEntry): Promise<void> => {
    const result = queue.then(() => write(entry));
    queue = result.catch(() => undefined);
    return result;
  };
}

function loadSdk<T>(moduleName: string): T {
  // Loaded on demand so neither SDK is needed at import time.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(moduleName) as T;
}

/** Creates an audit logger that writes one JSON object per event to S3. */
export function createS3AuditLogger(options: S3AuditSinkOptions): AuditLogger {
  const client: S3PutObjectClient =
    options.client ??
    (() => {
      const sdk = loadSdk<{
        S3Client: new () => S3PutObjectClient;
      }>('@aws-sdk/client-s3');
      return new sdk.S3Client({});
    })();

  return serialize(async (entry) => {
    const key = objectKey(options.prefix, entry);
    const params = {
      Bucket: options.bucket,
      Key: key,
      Body: `${JSON.stringify(entry)}\n`,
      ContentType: 'application/x-ndjson',
    };
    let command: unknown = params;
    try {
      const sdk = loadSdk<{ PutObjectCommand: new (input: typeof params) => unknown }>(
        '@aws-sdk/client-s3',
      );
      command = new sdk.PutObjectCommand(params);
    } catch {
      // With an injected mock client, plain params are sufficient.
    }
    await client.send(command);
  });
}

/** Creates an audit logger that writes one JSON object per event to GCS. */
export function createGcsAuditLogger(options: GcsAuditSinkOptions): AuditLogger {
  const client: GcsStorageClient =
    options.client ??
    (() => {
      const sdk = loadSdk<{ Storage: new () => GcsStorageClient }>('@google-cloud/storage');
      return new sdk.Storage();
    })();

  return serialize(async (entry) => {
    const key = objectKey(options.prefix, entry);
    await client.bucket(options.bucket).file(key).save(`${JSON.stringify(entry)}\n`);
  });
}

/** Composes multiple sinks; all sinks receive every event. */
export function combineAuditLoggers(...loggers: AuditLogger[]): AuditLogger {
  return async (entry) => {
    await Promise.all(loggers.map((logger) => logger(entry)));
  };
}
