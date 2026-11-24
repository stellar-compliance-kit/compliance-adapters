/**
 * Copyright (c) 2026 stellar-compliance-kit
 * SPDX-License-Identifier: MIT
 */

import { WebhookNotifier, redactAddress, redactAddresses } from '../src/notifier';

describe('webhook notifications', () => {
  const address = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  it('redacts addresses in both message and structured payload', async () => {
    const fetchImpl = jest.fn<Promise<Response>, [string, RequestInit]>().mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);
    const notifier = new WebhookNotifier('https://hooks.example.test/sync', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await notifier.notify({
      status: 'success',
      timestamp: '2026-01-01T00:00:00.000Z',
      checked: 2,
      added: [redactAddress(address)],
      failed: [],
      invalid: 0,
      removed: 0,
    });
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.text).not.toContain(address);
    expect(body.text).toContain(redactAddress(address));
    expect(JSON.stringify(body)).not.toContain(address);
    expect(redactAddresses([address])).toEqual([redactAddress(address)]);
  });

  it('reports failures and surfaces non-2xx webhook responses', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 500 }) as Response);
    const notifier = new WebhookNotifier('https://hooks.example.test/sync', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(
      notifier.notify({
        status: 'failure',
        timestamp: '2026-01-01T00:00:00.000Z',
        checked: 0,
        added: [],
        failed: [],
        invalid: 0,
        removed: 0,
        error: 'rpc unavailable',
      }),
    ).rejects.toThrow('500');
  });
});
