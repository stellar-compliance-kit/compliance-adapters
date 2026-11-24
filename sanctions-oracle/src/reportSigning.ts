/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { createHash } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';

/** Ed25519 signature over the canonical JSON representation of a sync report. */
export interface SignedReport<T = unknown> {
  algorithm: 'ed25519';
  /** SHA-256 of the canonical JSON bytes, hex encoded, for integrity checks. */
  digest: string;
  /** Base64-encoded 64-byte Ed25519 signature over the canonical JSON bytes. */
  signature: string;
  /** G... public key that produced the signature. */
  publicKey: string;
  /** The unchanged sync report. */
  report: T;
}

/** Deterministically sort object keys so the same report always has one byte representation. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

function toKeypair(key: Keypair | string): Keypair {
  return typeof key === 'string' ? Keypair.fromSecret(key) : key;
}

/**
 * Sign a sync report with a configured Ed25519 key. The secret key can be a
 * Stellar `Keypair` (including a KMS-backed wrapper's public key is not enough
 * here) or an S... secret string, e.g. from an environment variable.
 */
export function signReport<T>(report: T, key: Keypair | string): SignedReport<T> {
  const keypair = toKeypair(key);
  const bytes = Buffer.from(canonicalJson(report), 'utf8');
  return {
    algorithm: 'ed25519',
    digest: createHash('sha256').update(bytes).digest('hex'),
    signature: keypair.sign(bytes).toString('base64'),
    publicKey: keypair.publicKey(),
    report,
  };
}

/**
 * Verify a report signature. Pass `expectedPublicKey` to also assert that the
 * configured signing key is the one you trust. Returns false (never throws)
 * for malformed signatures or public keys.
 */
export function verifyReportSignature<T>(
  signed: SignedReport<T>,
  expectedPublicKey?: string,
): boolean {
  try {
    if (signed.algorithm !== 'ed25519' || !signed.publicKey || !signed.signature) return false;
    if (expectedPublicKey && signed.publicKey !== expectedPublicKey) return false;
    const bytes = Buffer.from(canonicalJson(signed.report), 'utf8');
    if (createHash('sha256').update(bytes).digest('hex') !== signed.digest) return false;
    return Keypair.fromPublicKey(signed.publicKey).verify(
      bytes,
      Buffer.from(signed.signature, 'base64'),
    );
  } catch {
    return false;
  }
}
