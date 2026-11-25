/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { Keypair } from '@stellar/stellar-sdk';

/**
 * Pluggable transaction signer so the oracle key can live in a KMS/HSM
 * instead of process memory. `sign` receives the 32-byte transaction hash and
 * must return a raw 64-byte Ed25519 signature.
 *
 * @example
 * ```ts
 * import { Keypair } from '@stellar/stellar-sdk';
 * import type { Signer } from './signer';
 *
 * const signer: Signer = {
 *   publicKey: () => Keypair.random().publicKey(),
 *   sign: async (txHash) => Buffer.alloc(64),
 * };
 * ```
 */
export interface Signer {
  publicKey(): string;
  sign(txHash: Buffer): Promise<Buffer>;
}

/**
 * Default {@link Signer} backed by an in-memory `Keypair`.
 *
 * @example
 * ```ts
 * import { Keypair } from '@stellar/stellar-sdk';
 * import { KeypairSigner } from './signer';
 *
 * const signer = new KeypairSigner(Keypair.random());
 * console.log(signer.publicKey());
 * ```
 */
export class KeypairSigner implements Signer {
  constructor(private readonly keypair: Keypair) {}

  publicKey(): string {
    return this.keypair.publicKey();
  }

  async sign(txHash: Buffer): Promise<Buffer> {
    return this.keypair.sign(txHash);
  }
}

/**
 * Accepts either a `Keypair` (backward compatible) or any {@link Signer}.
 *
 * @example
 * ```ts
 * import { Keypair } from '@stellar/stellar-sdk';
 * import { toSigner } from './signer';
 *
 * const signer = toSigner(Keypair.random());
 * console.log(signer.publicKey());
 * ```
 */
export function toSigner(signer: Keypair | Signer): Signer {
  return signer instanceof Keypair ? new KeypairSigner(signer) : signer;
}

/**
 * Signs `tx` with `signer` by adding a decorated signature over its hash.
 *
 * @example
 * ```ts
 * import { Keypair } from '@stellar/stellar-sdk';
 * import { toSigner, signTransaction } from './signer';
 *
 * const signer = toSigner(Keypair.random());
 * const tx = {
 *   hash: () => Buffer.alloc(32),
 *   addSignature: (publicKey: string, signature: string) => {
 *     console.log(publicKey, signature);
 *   },
 * };
 * await signTransaction(tx, signer);
 * ```
 */
export async function signTransaction(
  tx: { hash(): Buffer; addSignature(publicKey: string, signature: string): void },
  signer: Signer,
): Promise<void> {
  const signature = await signer.sign(tx.hash());
  tx.addSignature(signer.publicKey(), signature.toString('base64'));
}