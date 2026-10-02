import { describe, expect, it } from 'vitest';
import { computeBackoffMs, withRetry } from '../src/retry.js';
import { NotificationError } from '../src/errors.js';

describe('computeBackoffMs', () => {
  it('doubles each attempt within +-20% jitter, capped at maxDelayMs', () => {
    const config = { attempts: 5, initialDelayMs: 500, maxDelayMs: 5000 };
    const ms1 = computeBackoffMs(1, config);
    const ms2 = computeBackoffMs(2, config);
    const ms5 = computeBackoffMs(5, config);

    expect(ms1).toBeGreaterThanOrEqual(400);
    expect(ms1).toBeLessThanOrEqual(600);
    expect(ms2).toBeGreaterThanOrEqual(800);
    expect(ms2).toBeLessThanOrEqual(1200);
    expect(ms5).toBeLessThanOrEqual(5000);
  });

  it('uses Retry-After verbatim when provided', () => {
    const config = { attempts: 3, initialDelayMs: 500, maxDelayMs: 5000 };
    expect(computeBackoffMs(1, config, 2000)).toBe(2000);
  });
});

describe('withRetry', () => {
  it('does not retry non-retryable NotificationErrors', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new NotificationError({ code: 'PROVIDER_AUTH_ERROR', retryable: false });
    };

    await expect(
      withRetry(fn, { attempts: 3, initialDelayMs: 1, maxDelayMs: 1 }, { sleep: async () => {} }),
    ).rejects.toThrow(NotificationError);
    expect(calls).toBe(1);
  });

  it('retries retryable errors up to `attempts` times then throws', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new NotificationError({ code: 'PROVIDER_ERROR', retryable: true });
    };

    await expect(
      withRetry(fn, { attempts: 3, initialDelayMs: 1, maxDelayMs: 1 }, { sleep: async () => {} }),
    ).rejects.toThrow(NotificationError);
    expect(calls).toBe(3);
  });

  it('returns on first success without exhausting attempts', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 2) throw new NotificationError({ code: 'PROVIDER_ERROR', retryable: true });
      return 'ok';
    };

    const { result, attempts } = await withRetry(
      fn,
      { attempts: 5, initialDelayMs: 1, maxDelayMs: 1 },
      { sleep: async () => {} },
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });
});
