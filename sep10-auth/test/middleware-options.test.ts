/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { createSep10Middleware } from '../src/middleware';
import type { Sep10MiddlewareOptions } from '../src/middleware';

const valid: Sep10MiddlewareOptions = {
  serverAccountId: 'GSERVERACCOUNTIDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  homeDomains: 'example.com',
  webAuthDomain: 'example.com',
};

describe('createSep10Middleware - option validation at creation time', () => {
  it('accepts valid options', () => {
    expect(() => createSep10Middleware(valid)).not.toThrow();
  });

  it('accepts array forms', () => {
    expect(() =>
      createSep10Middleware({
        ...valid,
        homeDomains: ['example.com', 'alt.example.com'],
        webAuthDomain: ['example.com'],
      }),
    ).not.toThrow();
  });

  it.each([
    ['an empty serverAccountId', { serverAccountId: '' }, /serverAccountId/],
    ['a blank serverAccountId', { serverAccountId: '   ' }, /serverAccountId/],
    ['an empty homeDomains array', { homeDomains: [] }, /homeDomains/],
    ['an empty homeDomains string', { homeDomains: '' }, /homeDomains/],
    ['a blank entry in homeDomains', { homeDomains: ['example.com', ' '] }, /homeDomains/],
    ['an empty webAuthDomain array', { webAuthDomain: [] }, /webAuthDomain/],
    ['an empty webAuthDomain string', { webAuthDomain: '' }, /webAuthDomain/],
  ])('throws synchronously for %s', (_description, override, expected) => {
    expect(() =>
      createSep10Middleware({ ...valid, ...override } as Sep10MiddlewareOptions),
    ).toThrow(expected);
  });

  it('throws a TypeError, not a bare Error', () => {
    expect(() => createSep10Middleware({ ...valid, serverAccountId: '' })).toThrow(TypeError);
  });

  it('names the factory in the message so the misconfigured call site is obvious', () => {
    expect(() => createSep10Middleware({ ...valid, homeDomains: [] })).toThrow(
      /^createSep10Middleware: /,
    );
  });

  it('does not validate the shape of a serverAccountId, only that it is present', () => {
    // Whether it is a real Stellar key stays verifyChallenge's business.
    expect(() => createSep10Middleware({ ...valid, serverAccountId: 'not-a-key' })).not.toThrow();
  });
});
