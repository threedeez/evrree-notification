import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNotifier } from '../../src/index.js';
import { silentLogger } from '../helpers.js';

// Requires Mailpit running locally:
//   docker compose -f docker-compose.test.yml up -d --wait
// This file is only picked up by `pnpm test:integration`
// (vitest.integration.config.ts), never by the regular `pnpm test` run -
// it needs Docker, which plain unit test runs must not depend on.

const MAILPIT_API = process.env.MAILPIT_API_URL ?? 'http://localhost:8025';
const SMTP_HOST = process.env.SMTP_HOST ?? 'localhost';
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 1025);

interface MailpitMessage {
  ID: string;
  To: { Address: string }[];
  Subject: string;
}
interface MailpitMessageDetail extends MailpitMessage {
  Text: string;
  HTML: string;
  Attachments: { FileName: string }[];
}

async function deleteAllMessages() {
  await fetch(`${MAILPIT_API}/api/v1/messages`, { method: 'DELETE' });
}

async function waitForMessage(subject: string, timeoutMs = 5000): Promise<MailpitMessageDetail> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT_API}/api/v1/messages`);
    const data = (await res.json()) as { messages: MailpitMessage[] };
    const match = data.messages.find((m) => m.Subject === subject);
    if (match) {
      const detailRes = await fetch(`${MAILPIT_API}/api/v1/message/${match.ID}`);
      return (await detailRes.json()) as MailpitMessageDetail;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Mailpit: no message with subject "${subject}" arrived within ${timeoutMs}ms`);
}

function makeNotifier() {
  return createNotifier({
    appName: 'Evrree CBT',
    defaultCountryCode: 'NG',
    email: {
      from: { name: 'Evrree', address: 'no-reply@evrree.com' },
      providers: [
        { type: 'smtp', host: SMTP_HOST, port: SMTP_PORT, secure: false, auth: { user: '', pass: '' } },
      ],
    },
    logger: silentLogger,
  });
}

describe('SMTP provider against a real Mailpit server (AC8)', () => {
  beforeAll(async () => {
    await deleteAllMessages();
  });
  afterAll(async () => {
    await deleteAllMessages();
  });

  it('delivers recipient, subject, html, text and an attachment correctly', async () => {
    const subject = `Integration test ${Date.now()}`;
    const result = await makeNotifier().email.send({
      to: 'student@example.com',
      subject,
      html: '<p>Your exam starts at <b>9am</b>.</p>',
      text: 'Your exam starts at 9am.',
      attachments: [{ filename: 'schedule.txt', content: 'Room 4B', contentType: 'text/plain' }],
    });

    expect(result.status).toBe('sent');
    expect(result.provider).toBe('smtp');
    expect(result.providerMessageId).toBeTruthy();

    const msg = await waitForMessage(subject);
    expect(msg.To[0]!.Address).toBe('student@example.com');
    expect(msg.HTML).toContain('9am');
    expect(msg.Text).toContain('9am');
    expect(msg.Attachments.map((a) => a.FileName)).toContain('schedule.txt');
  });

  it('verify() reports healthy against a real server', async () => {
    const report = await makeNotifier().verify();
    expect(report.email).toEqual([{ ok: true, provider: 'smtp' }]);
  });
});
