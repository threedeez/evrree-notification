import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNotifier } from '../src/index.js';
import { silentLogger } from './helpers.js';

const send = vi.fn();
const subscribeToTopic = vi.fn();
const unsubscribeFromTopic = vi.fn();
const deleteApp = vi.fn();
const sendEachForMulticast = vi.fn();
const initializeApp = vi.fn(() => ({
  messaging: () => ({ send, subscribeToTopic, unsubscribeFromTopic, sendEachForMulticast }),
  delete: deleteApp,
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

describe('FCM provider: remaining error paths and lifecycle', () => {
  it('unsubscribeFromTopic maps a thrown error through mapError', async () => {
    unsubscribeFromTopic.mockRejectedValueOnce({ code: 'messaging/invalid-argument' });
    const notifier = make();
    await expect(notifier.push.unsubscribeFromTopic(['a'], 'topic')).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      retryable: false, // invalid-argument is a permanent/config problem
    });
  });

  it('subscribeToTopic maps messaging/authentication-error to PROVIDER_AUTH_ERROR', async () => {
    subscribeToTopic.mockRejectedValueOnce({ code: 'messaging/authentication-error' });
    const notifier = make();
    await expect(notifier.push.subscribeToTopic(['a'], 'topic')).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_ERROR',
      retryable: false,
    });
  });

  it('a topic send error with an unrecognised code maps to a retryable PROVIDER_ERROR', async () => {
    send.mockRejectedValueOnce({ code: 'messaging/internal-error' });
    const result = await make().push.send({ to: { topic: 'exam' }, title: 't', body: 'b' });
    expect(result.status).toBe('failed');
    expect(result.error).toMatchObject({ code: 'PROVIDER_ERROR', retryable: true });
  });

  it('close() deletes the underlying Firebase app, and is a no-op if never initialised', async () => {
    // Never initialised: no FCM call made yet on a fresh provider.
    const neverUsed = make();
    await expect(neverUsed.close()).resolves.toBeUndefined();
    expect(deleteApp).not.toHaveBeenCalled();

    // Initialised via a real send, then closed.
    const used = make();
    send.mockResolvedValueOnce('msg-1');
    await used.push.send({ to: { topic: 'exam' }, title: 't', body: 'b' });
    await used.close();
    expect(deleteApp).toHaveBeenCalledTimes(1);
  });
});
