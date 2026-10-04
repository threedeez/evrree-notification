import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNotifier } from '../src/index.js';
import { silentLogger } from './helpers.js';

const sendEachForMulticast = vi.fn();
const initializeApp = vi.fn(() => ({
  messaging: () => ({ sendEachForMulticast }),
  delete: vi.fn(),
}));

vi.mock('firebase-admin', () => ({
  default: { initializeApp, credential: { cert: (x: unknown) => x } },
  initializeApp,
  credential: { cert: (x: unknown) => x },
}));

afterEach(() => vi.clearAllMocks());

const serviceAccount = { projectId: 'p', clientEmail: 'e@p.iam.gserviceaccount.com', privateKey: 'KEY' };

function make() {
  return createNotifier({
    appName: 'X',
    defaultCountryCode: 'NG',
    push: { providers: [{ type: 'fcm', serviceAccount }] },
    retry: { attempts: 1 },
    logger: silentLogger,
  });
}

describe('FCM: a whole batch call rejecting (not a per-token error)', () => {
  it('one batch throwing and another succeeding: still "sent", using the successful batch\'s messageId', async () => {
    sendEachForMulticast
      .mockRejectedValueOnce(new Error('network blip for this batch'))
      .mockResolvedValueOnce({
        successCount: 1,
        failureCount: 0,
        responses: [{ success: true, messageId: 'batch-2-msg' }],
      });

    const tokens = [...Array.from({ length: 500 }, (_, i) => `a${i}`), 'b0'];
    const res = await make().push.send({ to: { tokens }, title: 't', body: 'b' });

    expect(sendEachForMulticast).toHaveBeenCalledTimes(2);
    expect(res.status).toBe('sent');
    expect(res.providerMessageId).toBe('batch-2-msg');
  });

  it('every batch call rejecting -> the whole send fails', async () => {
    sendEachForMulticast.mockRejectedValue(new Error('down'));
    const res = await make().push.send({ to: { tokens: ['a', 'b'] }, title: 't', body: 'b' });
    expect(res.status).toBe('failed');
  });
});

describe('FCM: a per-token failure with a non-dead-token error code', () => {
  it('is NOT added to invalidTokens, and counts toward the overall failure when nothing else succeeds', async () => {
    sendEachForMulticast.mockResolvedValueOnce({
      successCount: 0,
      failureCount: 1,
      responses: [{ success: false, error: { code: 'messaging/internal-error' } }],
    });
    const res = await make().push.send({ to: { tokens: ['a'] }, title: 't', body: 'b' });
    expect(res.status).toBe('failed');
    expect(res.invalidTokens).toBeUndefined();
  });

  it('is excluded from invalidTokens even when at least one other token succeeds', async () => {
    sendEachForMulticast.mockResolvedValueOnce({
      successCount: 1,
      failureCount: 1,
      responses: [
        { success: true, messageId: 'ok-1' },
        { success: false, error: { code: 'messaging/internal-error' } },
      ],
    });
    const res = await make().push.send({ to: { tokens: ['a', 'b'] }, title: 't', body: 'b' });
    expect(res.status).toBe('sent');
    // The provider itself returns invalidTokens: [] (not dead, so not
    // flagged for deletion); the Notifier then flattens an *empty* array to
    // undefined on the final SendResult to avoid `invalidTokens: []` noise
    // on every ordinary send - see notifier.ts's runDelivery.
    expect(res.invalidTokens).toBeUndefined();
  });
});
