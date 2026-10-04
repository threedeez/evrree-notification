import { describe, expect, it } from 'vitest';
import {
  assertValidEmail,
  isValidEmail,
  normalizeEmailAddress,
  normalizeEmailAddressList,
  redactEmail,
} from '../src/validation/email.js';
import { NotificationError } from '../src/errors.js';

describe('isValidEmail / assertValidEmail', () => {
  it('accepts normal addresses, rejects malformed ones', () => {
    expect(isValidEmail('ada@example.com')).toBe(true);
    expect(isValidEmail('  ada@example.com  ')).toBe(true); // trimmed
    expect(isValidEmail('no-at-sign.com')).toBe(false);
    expect(isValidEmail('no-domain@')).toBe(false);
    expect(isValidEmail('@no-local.com')).toBe(false);
  });

  it('assertValidEmail throws INVALID_RECIPIENT with a redacted address in the message', () => {
    expect(() => assertValidEmail('not-an-email')).toThrow(NotificationError);
    try {
      assertValidEmail('not-an-email');
    } catch (err) {
      expect((err as NotificationError).message).not.toContain('not-an-email');
      expect((err as NotificationError).message).toContain('***');
    }
    try {
      assertValidEmail('ada@gmail.com'); // valid, should not throw
    } catch {
      throw new Error('should not have thrown for a valid address');
    }
  });

  it('a malformed-but-single-@ address gets redactEmail-style masking in the error (local part kept, rest starred)', () => {
    // 'bad@format' has exactly one '@' but no dot in the domain, so it's
    // invalid - and unlike 'bad@@format' (empty domain segment -> falls back
    // to '***'), this exercises the actual b***@domain redaction branch.
    try {
      assertValidEmail('bad@format');
    } catch (err) {
      expect((err as NotificationError).message).toMatch(/b\*+@format/);
    }
  });

  it('an address with more than one "@" has no valid domain to redact, so it falls back to ***', () => {
    try {
      assertValidEmail('bad@@format');
    } catch (err) {
      expect((err as NotificationError).message).toBe('Invalid email address: ***');
    }
  });
});

describe('normalizeEmailAddress / normalizeEmailAddressList', () => {
  it('accepts a bare string or an EmailAddress object, trims whitespace', () => {
    expect(normalizeEmailAddress(' ada@example.com ')).toEqual({ address: 'ada@example.com' });
    expect(normalizeEmailAddress({ name: 'Ada', address: 'ada@example.com' })).toEqual({
      name: 'Ada',
      address: 'ada@example.com',
    });
  });

  it('list form: undefined -> [], single -> [one], array -> mapped', () => {
    expect(normalizeEmailAddressList(undefined)).toEqual([]);
    expect(normalizeEmailAddressList('a@b.com')).toEqual([{ address: 'a@b.com' }]);
    expect(normalizeEmailAddressList(['a@b.com', { address: 'c@d.com' }])).toEqual([
      { address: 'a@b.com' },
      { address: 'c@d.com' },
    ]);
  });
});

describe('redactEmail', () => {
  it('keeps the first local-part letter and the full domain', () => {
    expect(redactEmail('jane@gmail.com')).toBe('j***@gmail.com');
    expect(redactEmail('al@x.co')).toBe('a***@x.co'); // pads to a minimum of 3 stars
  });

  it('falls back to *** for malformed input with no local or domain part', () => {
    expect(redactEmail('@nolocal.com')).toBe('***');
    expect(redactEmail('nodomain@')).toBe('***');
  });
});
