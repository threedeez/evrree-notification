import { parsePhoneNumberWithError } from 'libphonenumber-js';
import { NotificationError } from '../errors.js';

/** Normalises a local or international number to E.164, e.g. 08031234567 -> +2348031234567. */
export function normalizePhoneNumber(raw: string, defaultCountryCode: string): string {
  try {
    const parsed = parsePhoneNumberWithError(raw, defaultCountryCode as never);
    if (!parsed.isValid()) {
      throw new Error('invalid number');
    }
    return parsed.number; // already E.164
  } catch (cause) {
    throw new NotificationError({
      code: 'INVALID_RECIPIENT',
      channel: 'sms',
      message: `Invalid phone number: ${redactPhone(raw)}`,
      cause,
    });
  }
}

/** Normalises a list, dropping duplicates after normalisation (order-preserving). */
export function normalizePhoneNumberList(raw: string[], defaultCountryCode: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const number of raw) {
    const normalized = normalizePhoneNumber(number, defaultCountryCode);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

/** +234803****567 style redaction for logs/results. See AC33. */
export function redactPhone(e164: string): string {
  const digits = e164.replace(/[^\d+]/g, '');
  if (digits.length < 7) return '***';
  const head = digits.slice(0, 7); // e.g. +234803
  const tail = digits.slice(-3);
  return `${head}****${tail}`;
}
