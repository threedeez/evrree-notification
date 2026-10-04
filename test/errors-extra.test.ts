import { describe, expect, it } from 'vitest';
import { NotificationError } from '../src/errors.js';

describe('NotificationError.cause redaction (AC34)', () => {
  it('redacts secrets in a plain string cause', () => {
    const err = new NotificationError({ code: 'PROVIDER_ERROR', cause: 'api_key=sk_live_ABC123 failed' });
    expect(err.cause).not.toContain('sk_live_ABC123');
    expect(err.cause).toContain('[REDACTED]');
  });

  it('redacts secrets in an Error cause, including its stack', () => {
    const original = new Error('auth_token: "xyz-secret-999" rejected');
    original.stack = 'Error: auth_token: "xyz-secret-999" rejected\n  at somewhere';
    const err = new NotificationError({ code: 'PROVIDER_ERROR', cause: original });
    const cause = err.cause as Error;
    expect(cause).toBeInstanceOf(Error);
    expect(cause.name).toBe('Error');
    expect(cause.message).not.toContain('xyz-secret-999');
    expect(cause.message).toContain('[REDACTED]');
    expect(cause.stack).not.toContain('xyz-secret-999');
  });

  it('passes through a non-Error, non-string cause unchanged (e.g. a plain data object)', () => {
    const cause = { retryAfterMs: 2000 };
    const err = new NotificationError({ code: 'RATE_LIMITED', retryable: true, cause });
    expect(err.cause).toBe(cause);
  });

  it('passes through null/undefined cause as-is', () => {
    expect(new NotificationError({ code: 'PROVIDER_ERROR' }).cause).toBeUndefined();
    expect(new NotificationError({ code: 'PROVIDER_ERROR', cause: null }).cause).toBeNull();
  });
});
