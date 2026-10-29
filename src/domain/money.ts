import { Decimal } from 'decimal.js';
import { badRequest } from '../lib/errors.js';
import { CURRENCIES, type CurrencyCode } from './currencies.js';

// All money math goes through this Decimal clone. JavaScript numbers are never
// used for amounts: 0.1 + 0.2 !== 0.3 is not acceptable in a ledger.
export const Money = Decimal.clone({
  precision: 60,
  rounding: Decimal.ROUND_DOWN,
  toExpNeg: -60,
  toExpPos: 60,
});
export type Money = Decimal;

/** Largest amount a single request may move. Keeps sums far inside NUMERIC(38,6). */
export const MAX_AMOUNT = new Money('1000000000000'); // 1 trillion units

const AMOUNT_PATTERN = /^(0|[1-9]\d*)(\.\d+)?$/;

/**
 * Parses a client-supplied amount. Amounts must be decimal strings such as "100.50":
 * no JSON numbers (they may already have lost precision), no exponents, no signs.
 */
export function parseAmount(input: unknown, currency: CurrencyCode, field = 'amount'): Money {
  if (typeof input !== 'string' || !AMOUNT_PATTERN.test(input)) {
    throw badRequest('INVALID_AMOUNT', `${field} must be a positive decimal string, e.g. "100.50"`);
  }
  const amount = new Money(input);
  if (amount.isZero()) {
    throw badRequest('INVALID_AMOUNT', `${field} must be greater than zero`);
  }
  const { decimals } = CURRENCIES[currency];
  if (amount.decimalPlaces() > decimals) {
    throw badRequest(
      'INVALID_AMOUNT',
      `${field} allows at most ${decimals} decimal places for ${currency}`,
    );
  }
  if (amount.greaterThan(MAX_AMOUNT)) {
    throw badRequest('INVALID_AMOUNT', `${field} must not exceed ${MAX_AMOUNT.toFixed()}`);
  }
  return amount;
}

/**
 * Converts an amount at the given rate and rounds DOWN to the target currency's
 * smallest unit. Rounding down means a conversion can never create value: the
 * sub-unit remainder stays with the FX pool instead of being paid out.
 */
export function convert(amount: Money, rate: Money, to: CurrencyCode): Money {
  return amount.times(rate).toDecimalPlaces(CURRENCIES[to].decimals, Decimal.ROUND_DOWN);
}

/** Fixed-point string at the currency's precision, e.g. "100.500000". Used for DB and API. */
export function formatAmount(amount: Money, currency: CurrencyCode): string {
  return amount.toFixed(CURRENCIES[currency].decimals);
}
