import { unprocessable } from '../lib/errors.js';
import type { CurrencyCode } from './currencies.js';
import { convert, formatAmount, type Money } from './money.js';

/**
 * Converts `amount` of `from` into `to` at `rate`, rounding down (see convert()).
 * Rejects an amount so small that it rounds to zero: the client would pay and
 * receive nothing.
 */
export function convertOrReject(
  amount: Money,
  rate: Money,
  from: CurrencyCode,
  to: CurrencyCode,
): Money {
  const received = convert(amount, rate, to);
  if (received.isZero()) {
    throw unprocessable(
      'AMOUNT_TOO_SMALL',
      `${formatAmount(amount, from)} ${from} is worth less than the smallest unit of ${to}`,
    );
  }
  return received;
}
