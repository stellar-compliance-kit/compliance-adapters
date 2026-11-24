/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseDuration, runScheduler } from '../src/scheduler';

describe('scheduler mode', () => {
  let dir: string;
  let lockPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanctions-scheduler-'));
    lockPath = path.join(dir, 'sync.lock');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('parses durations', () => {
    expect(parseDuration('15m')).toBe(900_000);
    expect(parseDuration('30s')).toBe(30_000);
    expect(() => parseDuration('nope')).toThrow(/Invalid duration/);
  });

  it('runs the job and releases the lock', async () => {
    const run = jest.fn(async () => {});
    await runScheduler({
      everyMs: 1000,
      jitterMs: 500,
      lockPath,
      random: () => 0.5,
      sleep: async () => {},
      stopAfter: 2,
      run,
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('skips a tick when another process holds the lock', async () => {
    fs.writeFileSync(lockPath, String(process.pid));
    const run = jest.fn(async () => {});
    await runScheduler({
      everyMs: 1000,
      lockPath,
      sleep: async () => {},
      stopAfter: 1,
      run,
    });
    expect(run).not.toHaveBeenCalled();
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(String(process.pid));
  });
});
