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

  it('handles 404 responses with appropriate error message', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    const sender = new HttpWebhookSender({ url: 'http://localhost:9999/webhook', fetchImpl });

    await expect(sender.send(makeEvent())).rejects.toThrow(/status 404/);
  });

  it('handles 401 unauthorized responses', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 401 });
    const sender = new HttpWebhookSender({ url: 'http://localhost:9999/webhook', fetchImpl });

    await expect(sender.send(makeEvent())).rejects.toThrow(/status 401/);
  });

  it('handles 429 rate limit responses', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 429 });
    const sender = new HttpWebhookSender({ url: 'http://localhost:9999/webhook', fetchImpl });

    await expect(sender.send(makeEvent())).rejects.toThrow(/status 429/);
  });

  it('successfully sends events with complex event data structures', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const sender = new HttpWebhookSender({ url: 'http://localhost:9999/webhook', fetchImpl });

    const complexEvent = makeEvent({
      value: {
        address: 'GADDR',
        amount: '1000.50',
        timestamp: 1234567890,
        nested: { data: ['array', 'items'] },
      },
    });

    await sender.send(complexEvent);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.event).toEqual(complexEvent);
  });

  it('throws when fetch rejects with a network error', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('Network connection failed'));
    const sender = new HttpWebhookSender({ url: 'http://localhost:9999/webhook', fetchImpl });

    await expect(sender.send(makeEvent())).rejects.toThrow('Network connection failed');
  });

  it('preserves event data integrity when sending', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const sender = new HttpWebhookSender({ url: 'http://localhost:9999/webhook', fetchImpl });

    const originalEvent = makeEvent({
      id: 'evt-unique-123',
      ledger: 999,
      topic: ['custom_event_type'],
    });

    await sender.send(originalEvent);

    const [, init] = fetchImpl.mock.calls[0];
    const sentEvent = JSON.parse(init.body).event;
    expect(sentEvent.id).toBe(originalEvent.id);
    expect(sentEvent.ledger).toBe(originalEvent.ledger);
    expect(sentEvent.topic).toEqual(originalEvent.topic);
  });
});
