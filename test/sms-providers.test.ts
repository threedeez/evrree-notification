import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotifier } from '../src/index.js';
import { isValidEmail, redactEmail } from '../src/validation/email.js';
import { silentLogger } from './helpers.js';

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const make = (providers: object[]) =>
  createNotifier({
    appName: 'X',
    defaultCountryCode: 'NG',
    sms: { senderId: 'Evrree', providers: providers as never },
    logger: silentLogger,
  });

const termii = { type: 'termii', apiKey: 'KEY123', channel: 'dnd' };
const twilio = { type: 'twilio', accountSid: 'AC1', authToken: 'TOK', from: '+15550001111' };

describe('Termii (AC11, AC13)', () => {
  it('single recipient -> /api/sms/send with the exact body', async () => {
    fetchMock.mockResolvedValue(json({ message_id: 'tm-1' }));
    const res = await make([termii]).sms.send({ to: '08031234567', text: 'Hello' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://v3.api.termii.com/api/sms/send');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      api_key: 'KEY123',
      to: '+2348031234567',
      from: 'Evrree',
      sms: 'Hello',
      type: 'plain',
      channel: 'dnd',
    });
    expect(res).toMatchObject({ status: 'sent', provider: 'termii', providerMessageId: 'tm-1' });
  });

  it('multiple recipients -> /api/sms/send/bulk', async () => {
    fetchMock.mockResolvedValue(json({ message_id: 'tm-2' }));
    await make([termii]).sms.send({ to: ['08031234567', '08059999999'], text: 'Hi' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://v3.api.termii.com/api/sms/send/bulk');
    expect(JSON.parse(init.body).to).toEqual(['+2348031234567', '+2348059999999']);
  });

  it('baseUrl is configurable', async () => {
    fetchMock.mockResolvedValue(json({ message_id: 'x' }));
    await make([{ ...termii, baseUrl: 'https://api.ng.termii.com' }]).sms.send({
      to: '08031234567',
      text: 'Hi',
    });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.ng.termii.com/api/sms/send');
  });
});

describe('Twilio (AC11)', () => {
  it('one form-encoded request per recipient with Basic auth', async () => {
    fetchMock.mockImplementation(async () => json({ sid: 'SM1' }));
    const res = await make([twilio]).sms.send({ to: ['08031234567', '08059999999'], text: 'Hello' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('AC1:TOK').toString('base64')}`);
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      To: '+2348031234567',
      From: '+15550001111',
      Body: 'Hello',
    });
    expect(res.providerMessageId).toBe('SM1');
  });
});

describe('HTTP error handling through the Notifier', () => {
  it('AC26 (end to end): Termii 503 x3 then falls back to Twilio', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('termii') ? new Response('down', { status: 503 }) : json({ sid: 'SM9' }),
    );
    const pending = make([termii, twilio]).sms.send({ to: '08031234567', text: 'x' });
    await vi.runAllTimersAsync();
    const res = await pending;
    expect(res).toMatchObject({ status: 'sent', provider: 'twilio', attempts: 4 });
  });

  it('AC27 (end to end): 401 is not retried and reports PROVIDER_AUTH_ERROR', async () => {
    fetchMock.mockResolvedValue(new Response('no', { status: 401 }));
    const res = await make([termii]).sms.send({ to: '08031234567', text: 'x' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.error).toMatchObject({ code: 'PROVIDER_AUTH_ERROR', statusCode: 401 });
    expect(res.error?.message).not.toContain('KEY123');
  });

  it('AC28 (end to end): 429 + Retry-After: 2 waits 2 seconds', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('slow down', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(json({ message_id: 'ok' }));
    const pending = make([termii]).sms.send({ to: '08031234567', text: 'x' });
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe('sent');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('400 is permanent (no retry); network failure is retryable', async () => {
    fetchMock.mockResolvedValue(new Response('bad', { status: 400 }));
    const res = await make([termii]).sms.send({ to: '08031234567', text: 'x' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.error?.code).toBe('PROVIDER_ERROR');

    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const pending = make([termii]).sms.send({ to: '08031234567', text: 'x' });
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((await pending).status).toBe('failed');
  });
});

describe('successful but unreadable body', () => {
  it('still counts as sent (no retry, no duplicate SMS)', async () => {
    fetchMock.mockImplementation(async () => new Response('OK', { status: 200 }));
    const res = await make([termii]).sms.send({ to: '08031234567', text: 'x' });
    expect(res.status).toBe('sent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('email validation helpers', () => {
  it('accepts and rejects addresses; redacts for logs', () => {
    expect(isValidEmail('ada@example.com')).toBe(true);
    expect(isValidEmail('ada@')).toBe(false);
    expect(isValidEmail('no spaces@x.com')).toBe(false);
    expect(redactEmail('jane@gmail.com')).toBe('j***@gmail.com');
  });
});
