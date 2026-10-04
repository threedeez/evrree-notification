import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotifier, NotificationError } from '../src/index.js';
import { createTestNotifier } from '../src/testing/index.js';
import { fakeSms, fail, ok, silentLogger, smsNotifier } from './helpers.js';

const templates = [
  {
    id: 'welcome',
    content: {
      email: { subject: 'Welcome {{recipient.name}}', html: '<p>Hi {{name}}</p>' },
      sms: { text: '{{appName}} {{year}} hi {{recipient.name}}' },
      push: { title: 'Hi', body: 'Hello {{recipient.name}}' },
    },
    locales: { ha: { sms: { text: 'Sannu {{recipient.name}}' } } },
  },
];

describe('templates', () => {
  const n = () => createTestNotifier({ templates });

  it('AC17: renders per-channel content with appName, recipient and year', async () => {
    const t = n();
    await t.sendTemplate('sms', 'welcome', { name: 'Ada', phone: '08031234567' }, {});
    expect(t.outbox.sms[0]!.text).toBe(`Test App ${new Date().getFullYear()} hi Ada`);
  });

  it('AC18: HTML-escapes variables in email html but not in subject/sms', async () => {
    const t = n();
    await t.sendTemplate('email', 'welcome', { name: '<script>', email: 'a@b.com' }, { name: '<script>' });
    expect(t.outbox.email[0]!.html).toContain('&lt;script&gt;');
    expect(t.outbox.email[0]!.subject).toBe('Welcome <script>');
  });

  it('AC19: a missing variable throws TEMPLATE_RENDER_ERROR naming it', async () => {
    const t = n();
    await expect(t.sendTemplate('email', 'welcome', { email: 'a@b.com' }, {})).rejects.toMatchObject({
      code: 'TEMPLATE_RENDER_ERROR',
      message: expect.stringContaining('name'),
    });
  });

  it('AC20: recipient.locale picks that language, else falls back to English', async () => {
    const t = n();
    await t.sendTemplate('sms', 'welcome', { name: 'Ada', phone: '08031234567', locale: 'ha' }, {});
    await t.sendTemplate('sms', 'welcome', { name: 'Ada', phone: '08031234567', locale: 'yo' }, {});
    expect(t.outbox.sms[0]!.text).toBe('Sannu Ada');
    expect(t.outbox.sms[1]!.text).toContain('hi Ada');
  });

  it('AC21: templates.render returns content without sending', () => {
    const t = n();
    const out = t.templates.render('welcome', 'sms', { recipient: { name: 'Ada' } }) as { text: string };
    expect(out.text).toContain('hi Ada');
    expect(t.outbox.sms).toHaveLength(0);
  });

  it('AC22: the email layout wraps the body', async () => {
    const notifier = createNotifier({
      appName: 'X',
      defaultCountryCode: 'NG',
      email: {
        from: { address: 'a@b.com' },
        layout: '<header>H</header>{{{body}}}<footer>F</footer>',
        providers: [{ type: 'memory' }],
      },
      templates,
      logger: silentLogger,
    });
    const out = notifier.templates.render('welcome', 'email', {
      name: 'Ada',
      recipient: { name: 'Ada' },
    }) as { html: string };
    expect(out.html).toBe('<header>H</header><p>Hi Ada</p><footer>F</footer>');
  });

  it('unknown template -> TEMPLATE_NOT_FOUND; duplicate id -> CONFIG_ERROR unless override', () => {
    const t = n();
    expect(() => t.templates.get('nope')).toThrow(expect.objectContaining({ code: 'TEMPLATE_NOT_FOUND' }));
    expect(() => t.templates.register(templates[0]!)).toThrow(
      expect.objectContaining({ code: 'CONFIG_ERROR' }),
    );
    expect(() => t.templates.register(templates[0]!, { override: true })).not.toThrow();
    expect(t.templates.list()).toHaveLength(1);
  });

  it('a template without content for a channel throws TEMPLATE_NOT_FOUND', async () => {
    const t = createTestNotifier({ templates: [{ id: 'sms-only', content: { sms: { text: 'x' } } }] });
    await expect(t.sendTemplate('email', 'sms-only', { email: 'a@b.com' }, {})).rejects.toMatchObject({
      code: 'TEMPLATE_NOT_FOUND',
    });
  });
});

describe('notify (multi-channel)', () => {
  it('AC23: sends on channels with contact details + content, skips the rest', async () => {
    const t = createTestNotifier({ templates });
    const res = await t.notify({ name: 'Ada', email: 'a@b.com', phone: '08031234567' }, 'welcome', {
      name: 'Ada',
    });
    expect(res.results).toHaveLength(2);
    expect(res.succeeded).toEqual(['email', 'sms']);
    expect(res.failed).toEqual([]);
    expect(t.outbox.push).toHaveLength(0);
  });

  it('AC24: first-success sends SMS only if push fails', async () => {
    const t = createTestNotifier({ templates });
    const r = { name: 'Ada', phone: '08031234567', pushTokens: ['tok'] };
    await t.notify(r, 'welcome', {}, { channels: ['push', 'sms'], strategy: 'first-success' });
    expect(t.outbox.push).toHaveLength(1);
    expect(t.outbox.sms).toHaveLength(0);

    t.outbox.clear();
    t.failNext('push', new NotificationError({ code: 'PROVIDER_ERROR', retryable: false }));
    const res = await t.notify(r, 'welcome', {}, { channels: ['push', 'sms'], strategy: 'first-success' });
    expect(res.failed).toEqual(['push']);
    expect(res.succeeded).toEqual(['sms']);
    expect(t.outbox.sms).toHaveLength(1);
  });
});

describe('sendBulk', () => {
  it('AC25: 100 items, never >10 in flight, ordered results, one failure is isolated', async () => {
    let inFlight = 0;
    let max = 0;
    const provider = {
      name: 'a',
      async send(msg: { text: string }) {
        inFlight++;
        max = Math.max(max, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight--;
        if (msg.text === 'item-42') throw new NotificationError({ code: 'PROVIDER_ERROR', retryable: false });
        return { providerMessageId: msg.text };
      },
    };
    const notifier = smsNotifier([provider], { retry: { attempts: 1 } });
    const items = Array.from({ length: 100 }, (_, i) => ({
      channel: 'sms' as const,
      to: '08031234567',
      text: `item-${i}`,
    }));
    items[7] = { channel: 'sms', to: 'garbage', text: 'bad' }; // caller mistake must not reject the batch

    const results = await notifier.sendBulk(items, { concurrency: 10 });
    expect(results).toHaveLength(100);
    expect(max).toBeLessThanOrEqual(10);
    expect(results[0]!.providerMessageId).toBe('item-0');
    expect(results[99]!.providerMessageId).toBe('item-99');
    expect(results[42]!.status).toBe('failed');
    expect(results[7]!.status).toBe('failed');
    expect(results[7]!.error?.code).toBe('INVALID_RECIPIENT');
    expect(results.filter((r) => r.status === 'sent')).toHaveLength(98);
  });

  it('supports template items', async () => {
    const t = createTestNotifier({ templates });
    const results = await t.sendBulk([
      { templateId: 'welcome', channel: 'sms', recipient: { name: 'A', phone: '08031234567' }, data: {} },
    ]);
    expect(results[0]!.status).toBe('sent');
  });
});

describe('config validation (AC6)', () => {
  const bad = (cfg: object, field: string) =>
    expect(() => createNotifier({ appName: 'x', defaultCountryCode: 'NG', ...cfg } as never)).toThrow(
      expect.objectContaining({ code: 'CONFIG_ERROR', message: expect.stringContaining(field) }),
    );
  it('names the bad field', () => {
    bad(
      { email: { from: { address: 'a@b.com' }, providers: [{ type: 'smtp', port: 587 }] } },
      'email.providers[0].host',
    );
    bad({ sms: { providers: [{ type: 'termii', channel: 'dnd' }] } }, 'apiKey');
    bad({ sms: { providers: [] } }, 'sms.providers');
    bad({ sms: { providers: [{ type: 'twilio', from: '+1' }] } }, 'accountSid');
    bad({ push: { providers: [{ type: 'fcm' }] } }, 'serviceAccount');
    bad({ push: { providers: [] } }, 'push.providers');
    expect(() => createNotifier({ appName: '', defaultCountryCode: 'NG' })).toThrow(/appName/);
  });
});

describe('privacy (AC33)', () => {
  it('logs and results never contain full emails, phones, tokens, bodies or codes', async () => {
    const logs: string[] = [];
    const cap = (...a: unknown[]) => logs.push(JSON.stringify(a));
    const notifier = createNotifier({
      appName: 'X',
      defaultCountryCode: 'NG',
      email: { from: { address: 'no-reply@x.com' }, providers: [{ type: 'console' }] },
      sms: { providers: [{ type: 'console' }] },
      push: { providers: [{ type: 'console' }] },
      templates: [
        {
          id: 'otp',
          content: {
            email: { subject: 'Code', html: '<p>{{code}}</p>' },
            sms: { text: 'Your code {{code}}' },
            push: { title: 't', body: 'code {{code}}' },
          },
        },
      ],
      logger: { debug: cap, info: cap, warn: cap, error: cap },
    });
    const res = await notifier.notify(
      { email: 'ada.lovelace@gmail.com', phone: '08031234567', pushTokens: ['SECRET-DEVICE-TOKEN'] },
      'otp',
      { code: '482913' },
    );
    const dump = logs.join('\n') + JSON.stringify(res.results);
    for (const secret of [
      'ada.lovelace@gmail.com',
      '+2348031234567',
      '08031234567',
      'SECRET-DEVICE-TOKEN',
      '482913',
      'Your code',
    ]) {
      expect(dump).not.toContain(secret);
    }
  });
});

describe('verify (AC37) and errors (AC34)', () => {
  it('reports per-provider health without throwing', async () => {
    const good = { name: 'good', send: async () => ({}), verify: async () => {} };
    const bad = {
      name: 'bad',
      send: async () => ({}),
      verify: async () => {
        throw new Error('nope');
      },
    };
    const n = smsNotifier([good, bad]);
    const report = await n.verify();
    expect(report.sms).toEqual([
      { ok: true, provider: 'good' },
      { ok: false, provider: 'bad', error: 'nope' },
    ]);
    expect(report.email).toEqual([]);
  });

  it('strips secrets from error cause and message', () => {
    const err = new NotificationError({
      code: 'PROVIDER_ERROR',
      cause: new Error('failed {"api_key":"sk_live_abc123"} authorization: Bearer xyz'),
    });
    const text = String((err.cause as Error).message);
    expect(text).not.toContain('sk_live_abc123');
    expect(text).toContain('[REDACTED]');
  });

  it('caller-mistake codes are never retryable', () => {
    expect(new NotificationError({ code: 'INVALID_RECIPIENT', retryable: true }).retryable).toBe(false);
  });
});

describe('testing helper (AC36)', () => {
  it('exposes outbox, clear() and failNext()', async () => {
    const t = createTestNotifier();
    await t.email.send({ to: 'a@b.com', subject: 'Reset', text: 'x' });
    expect(t.outbox.email[0]!.subject).toContain('Reset');
    t.outbox.clear();
    expect(t.outbox.email).toHaveLength(0);
    t.failNext('sms', new NotificationError({ code: 'PROVIDER_ERROR', retryable: false }));
    const r = await t.sms.send({ to: '08031234567', text: 'x' });
    expect(r.status).toBe('failed');
  });
});

describe('generic send() and push validation', () => {
  it('routes by channel', async () => {
    const t = createTestNotifier();
    await t.send({ channel: 'sms', to: '08031234567', text: 'x' });
    await t.send({ channel: 'push', to: { tokens: ['t'] }, title: 'a', body: 'b' });
    expect(t.outbox.sms).toHaveLength(1);
    expect(t.outbox.push).toHaveLength(1);
  });
  it('rejects empty tokens and non-string data', async () => {
    const t = createTestNotifier();
    await expect(t.push.send({ to: { tokens: [] }, title: 'a', body: 'b' })).rejects.toMatchObject({
      code: 'INVALID_MESSAGE',
    });
    await expect(
      t.push.send({ to: { tokens: ['t'] }, title: 'a', body: 'b', data: { n: 1 as unknown as string } }),
    ).rejects.toMatchObject({ code: 'INVALID_MESSAGE' });
  });
});

// keep the imports used
void fakeSms;
void fail;
void ok;
void beforeEach;
void afterEach;
void vi;
