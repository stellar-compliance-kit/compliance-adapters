/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { Keypair } from '@stellar/stellar-sdk';
import { canonicalJson, signReport, verifyReportSignature } from '../src/reportSigning';

describe('sync report signing', () => {
  const key = Keypair.random();

  it('produces a deterministic canonical representation', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe('{"a":[2,{"c":3,"d":4}],"b":1}');
  });

  it('signs and verifies a report with the configured key', () => {
    const signed = signReport({ checked: 3, written: ['GABC'], failed: [] }, key);
    expect(signed.algorithm).toBe('ed25519');
    expect(signed.publicKey).toBe(key.publicKey());
    expect(verifyReportSignature(signed, key.publicKey())).toBe(true);
  });

  it('rejects tampered reports, wrong keys and malformed signatures', () => {
    const signed = signReport({ checked: 1 }, key);
    expect(verifyReportSignature({ ...signed, report: { checked: 2 } }, key.publicKey())).toBe(
      false,
    );
    expect(verifyReportSignature(signed, Keypair.random().publicKey())).toBe(false);
    expect(verifyReportSignature({ ...signed, signature: 'not-base64!!' })).toBe(false);
  });
});
