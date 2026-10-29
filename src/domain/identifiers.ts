import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { badRequest } from '../lib/errors.js';

/** Emails are stored lowercased so "Ada@Mail.com" and "ada@mail.com" are one wallet. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Phones are stored in E.164 (e.g. +2348012345678) so "+234 801 234 5678" and
 * "+2348012345678" are one wallet. A country code is required: the API serves many
 * countries, so guessing one from a local number like "0801..." would be unsafe.
 */
export function normalizePhone(phone: string): string {
  const parsed = parsePhoneNumberFromString(phone.trim());
  if (!phone.trim().startsWith('+') || !parsed?.isValid()) {
    throw badRequest(
      'INVALID_PHONE',
      'phone must be a valid number in international format, e.g. +2348012345678',
    );
  }
  return parsed.number;
}
