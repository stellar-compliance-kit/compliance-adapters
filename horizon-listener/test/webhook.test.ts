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

  it('includes URL and status code in error message when response is not ok', async () => {
    const url = 'http://localhost:9999/webhook';
    const status = 503;
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status });
    const sender = new HttpWebhookSender({ url, fetchImpl });

    const error = await sender.send(makeEvent()).catch((e) => e);
    expect(error.message).toContain(url);
    expect(error.message).toContain(String(status));
  });
});
