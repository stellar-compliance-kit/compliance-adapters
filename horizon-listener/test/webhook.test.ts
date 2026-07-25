import { createHmac } from 'node:crypto';
import { HttpWebhookSender } from '../src/webhook';
import type { RawContractEvent } from '../src/eventSource';

function makeEvent(overrides: Partial<RawContractEvent> = {}): RawContractEvent {
  return {
    id: 'evt-1',
    contractId: 'CDENYLISTGATE',
    ledger: 100,
    topic: ['denylist_added'],
    value: { address: 'GADDR' },
    ...overrides,
  };
}

describe('HttpWebhookSender', () => {
  it('POSTs the event as JSON with the expected URL, method, and headers', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const sender = new HttpWebhookSender({ url: 'http://localhost:9999/webhook', fetchImpl });

    const event = makeEvent();
    await sender.send(event);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:9999/webhook');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ event });
  });

  it('throws when the response is not ok', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    const sender = new HttpWebhookSender({ url: 'http://localhost:9999/webhook', fetchImpl });

    await expect(sender.send(makeEvent())).rejects.toThrow(/status 500/);
  });

  it('omits the signature header when no signing secret is configured', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const sender = new HttpWebhookSender({ url: 'http://localhost:9999/webhook', fetchImpl });

    await sender.send(makeEvent());

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('adds a correctly computed X-Signature header when a signing secret is configured', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const secret = 'test-secret';
    const sender = new HttpWebhookSender({
      url: 'http://localhost:9999/webhook',
      signingSecret: secret,
      fetchImpl,
    });

    const event = makeEvent();
    await sender.send(event);

    const [, init] = fetchImpl.mock.calls[0];
    const expectedSignature = `sha256=${createHmac('sha256', secret).update(init.body).digest('hex')}`;

    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Signature': expectedSignature,
    });
  });

  it('computes the documented signature for a known payload/secret pair', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const sender = new HttpWebhookSender({
      url: 'http://localhost:9999/webhook',
      signingSecret: 'known-secret',
      fetchImpl,
    });

    await sender.send(
      makeEvent({
        id: 'evt-known',
        contractId: 'CDENYLISTGATE',
        ledger: 42,
        topic: ['denylist_added'],
        value: { address: 'GADDR' },
      }),
    );

    const [, init] = fetchImpl.mock.calls[0];
    // Known-answer test: sha256 HMAC of the fixed body above under
    // 'known-secret', pre-computed independently of the implementation.
    expect(init.headers['X-Signature']).toBe(
      'sha256=faa29f8daafdc12e25edce9bbb0f6ad78fa793831b6fb949bfc77133282d32cf',
    );
  });
});
