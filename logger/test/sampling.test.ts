/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { createSampledLogger, getChildLogger, jsonLogger, type JsonLogStream } from '../src/index';

describe('createSampledLogger', () => {
  function makeBase() {
    return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  }

  afterEach(() => jest.restoreAllMocks());

  it('emits every debug call at rate 1 and none at rate 0', () => {
    const always = makeBase();
    createSampledLogger(always, 1).debug('yes');
    expect(always.debug).toHaveBeenCalledWith('yes');

    const never = makeBase();
    createSampledLogger(never, 0).debug('no');
    expect(never.debug).not.toHaveBeenCalled();
  });

  it('applies the rate only to debug calls, leaving info/warn/error intact', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.99);
    const base = makeBase();
    const logger = createSampledLogger(base, { debugSampleRate: 0.5 });
    logger.debug('dropped');
    logger.info('kept');
    logger.warn('kept');
    logger.error('kept');
    expect(base.debug).not.toHaveBeenCalled();
    expect(base.info).toHaveBeenCalledWith('kept');
    expect(base.warn).toHaveBeenCalledWith('kept');
    expect(base.error).toHaveBeenCalledWith('kept');
  });

  it('emits when the random draw is below the configured rate', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    const base = makeBase();
    createSampledLogger(base, 0.5).debug('kept');
    expect(base.debug).toHaveBeenCalledWith('kept');
  });

  it('rejects rates outside [0, 1]', () => {
    expect(() => createSampledLogger(makeBase(), 1.5)).toThrow();
    expect(() => createSampledLogger(makeBase(), -0.1)).toThrow();
  });

  it('preserves sampling for child loggers', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.9);
    const base = makeBase();
    const logger = createSampledLogger(base, 0.5);
    getChildLogger(logger, { component: 'test' }).debug('dropped');
    getChildLogger(logger, { component: 'test' }).info('kept');
    expect(base.debug).not.toHaveBeenCalled();
    expect(base.info).toHaveBeenCalledWith({ component: 'test' }, 'kept');
  });
});

describe('jsonLogger sampling', () => {
  function makeStream() {
    const chunks: string[] = [];
    const stream: JsonLogStream = { write: (chunk) => chunks.push(chunk) };
    return { chunks, stream };
  }

  afterEach(() => jest.restoreAllMocks());

  it('samples debug lines but always writes higher-severity lines', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.9);
    const { chunks, stream } = makeStream();
    const logger = jsonLogger({ stream, debugSampleRate: 0.25 });
    logger.debug('dropped');
    logger.info('kept');
    expect(chunks).toHaveLength(1);
    expect(JSON.parse(chunks[0]).msg).toBe('kept');
  });

  it('accepts sampleRate as an alias', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.01);
    const { chunks, stream } = makeStream();
    jsonLogger({ stream, sampleRate: 0.5 }).debug('kept');
    expect(chunks).toHaveLength(1);
  });
});
