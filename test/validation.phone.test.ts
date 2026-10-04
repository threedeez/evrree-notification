import { describe, expect, it } from 'vitest';
import { normalizePhoneNumber, normalizePhoneNumberList, redactPhone } from '../src/validation/phone.js';
import { NotificationError } from '../src/errors.js';

describe('normalizePhoneNumber (AC12)', () => {
  it.each(['0803 123 4567', '08031234567', '+2348031234567', '2348031234567'])(
    '%s normalises to +2348031234567',
    (input) => {
      expect(normalizePhoneNumber(input, 'NG')).toBe('+2348031234567');
    },
  );

  it('throws INVALID_RECIPIENT for garbage input', () => {
    expect(() => normalizePhoneNumber('12345', 'NG')).toThrow(NotificationError);
  });
});

describe('normalizePhoneNumberList', () => {
  it('de-duplicates after normalisation, preserving order', () => {
    const result = normalizePhoneNumberList(['0803 123 4567', '+2348031234567', '08059999999'], 'NG');
    expect(result).toEqual(['+2348031234567', '+2348059999999']);
  });
});

describe('redactPhone', () => {
  it('masks the middle digits', () => {
    expect(redactPhone('+2348031234567')).toBe('+234803****567');
  });
});
