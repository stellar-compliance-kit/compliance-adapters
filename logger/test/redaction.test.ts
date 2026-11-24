/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { REDACTED, createRedactingLogger, getChildLogger, noopLogger } from '../src/index';

describe('createRedactingLogger', () => {
  function makeBase() {
    return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  }

  it('redacts known secret field names by default at any depth', () => {
    const base = makeBase();
    createRedactingLogger(base, []).info('auth', {
      user: 'alice',
      privateKey: 'SSECRET',
      nested: { secret: 'hunter2', token: 'abc' },
    });
    expect(base.info).toHaveBeenCalledWith('auth', {
      user: 'alice',
      privateKey: REDACTED,
      nested: { secret: REDACTED, token: REDACTED },
    });
  });

  it('supports configurable dotted redaction paths with wildcards', () => {
    const base = makeBase();
    createRedactingLogger(base, { paths: ['*.secret', 'config.apiKey'] }).info('ctx', {
      account: { secret: 'hidden', label: 'visible' },
      config: { apiKey: 'key', region: 'eu' },
      other: { secret: 'also hidden' },
    });
    expect(base.info).toHaveBeenCalledWith('ctx', {
      account: { secret: REDACTED, label: 'visible' },
      config: { apiKey: REDACTED, region: 'eu' },
      other: { secret: REDACTED },
    });
  });

  it('honours custom additional keys, replacement text, and custom redactors', () => {
    const base = makeBase();
    createRedactingLogger(base, { keys: ['customerId'], replacement: '***' }).warn('log', {
      customerId: 'GABC',
      nested: { customerId: 'GDEF', ok: 1 },
    });
    expect(base.warn).toHaveBeenCalledWith('log', {
      customerId: '***',
      nested: { customerId: '***', ok: 1 },
    });

    const customBase = makeBase();
    createRedactingLogger(customBase, () => 'custom').error('boom');
    expect(customBase.error).toHaveBeenCalledWith('custom');
  });

  it('does not mutate the original object and forwards child bindings through redaction', () => {
    const base = makeBase();
    const original = { nested: { password: 'pw', safe: true } };
    const logger = createRedactingLogger(base, []);
    getChildLogger(logger, { apiKey: 'secret-value' }).info('msg', original);
    expect(original.nested.password).toBe('pw');
    expect(base.info).toHaveBeenCalledWith(
      { apiKey: REDACTED },
      'msg',
      { nested: { password: REDACTED, safe: true } },
    );
  });

  it('is safe with noopLogger and non-object arguments', () => {
    const logger = createRedactingLogger(noopLogger, []);
    expect(() => logger.debug('plain string', 42, undefined)).not.toThrow();
  });
});
