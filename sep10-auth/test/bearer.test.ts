/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { parseBearerToken } from '../src/bearer';

describe('parseBearerToken', () => {
  it('returns the token for a well-formed header', () => {
    expect(parseBearerToken('Bearer abc123')).toBe('abc123');
  });

  it('preserves a base64/XDR token verbatim', () => {
    const xdr = 'AAAAAgAAAAB+cmVhbGx5L2xvbmc9PQ==';
    expect(parseBearerToken(`Bearer ${xdr}`)).toBe(xdr);
  });

  it.each([
    ['a non-Bearer scheme', 'Basic abc123'],
    ['an empty header', ''],
    ['Bearer with no token', 'Bearer'],
    ['Bearer with only trailing whitespace', 'Bearer '],
    ['a bare token with no scheme', 'abc123'],
  ])('returns null for %s', (_description, header) => {
    expect(parseBearerToken(header)).toBeNull();
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
  ])('returns null for %s, so callers need no pre-check', (_description, header) => {
    expect(parseBearerToken(header)).toBeNull();
  });

  it('matches the scheme case-sensitively', () => {
    // Documented, deliberate: RFC 7235 makes schemes case-insensitive, but
    // relaxing this widens what authenticates, so the existing behaviour is
    // preserved rather than changed inside an extraction.
    expect(parseBearerToken('bearer abc123')).toBeNull();
    expect(parseBearerToken('BEARER abc123')).toBeNull();
  });

  it('keeps the first token when extra segments follow', () => {
    expect(parseBearerToken('Bearer abc123 trailing')).toBe('abc123');
  });

  it('returns null when the separator is doubled', () => {
    // 'Bearer  x'.split(' ') -> ['Bearer', '', 'x'], so the token reads empty.
    expect(parseBearerToken('Bearer  abc123')).toBeNull();
  });
});
