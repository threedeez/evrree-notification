import { NotificationError } from '../errors.js';
import type { EmailAddress } from '../types.js';

// Deliberately conservative RFC5322-ish check rather than a full grammar —
// good enough to catch typos without rejecting valid-but-unusual addresses.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(address: string): boolean {
  return EMAIL_PATTERN.test(address.trim());
}

export function assertValidEmail(address: string): void {
  if (!isValidEmail(address)) {
    throw new NotificationError({
      code: 'INVALID_RECIPIENT',
      channel: 'email',
      message: `Invalid email address: ${redact(address)}`,
    });
  }
}

export function normalizeEmailAddress(input: string | EmailAddress): EmailAddress {
  const addr = typeof input === 'string' ? { address: input } : input;
  assertValidEmail(addr.address);
  return { ...addr, address: addr.address.trim() };
}

export function normalizeEmailAddressList(
  input: string | EmailAddress | (string | EmailAddress)[] | undefined,
): EmailAddress[] {
  if (input == null) return [];
  const list = Array.isArray(input) ? input : [input];
  return list.map(normalizeEmailAddress);
}

/** j***@gmail.com style redaction for logs/results. See AC33. */
export function redactEmail(address: string): string {
  const [local, domain] = address.split('@');
  if (!local || !domain) return '***';
  const visible = local.slice(0, 1);
  return `${visible}${'*'.repeat(Math.max(3, local.length - 1))}@${domain}`;
}

function redact(address: string): string {
  return address.includes('@') ? redactEmail(address) : '***';
}
