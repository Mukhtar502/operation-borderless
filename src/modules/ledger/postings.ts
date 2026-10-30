import type { CurrencyCode } from '../../domain/currencies.js';
import type { Money } from '../../domain/money.js';
import type { Posting } from './ledger.service.js';

export interface Movement {
  fromWalletId: string;
  toWalletId: string;
  from: CurrencyCode;
  to: CurrencyCode;
  /** Amount of `from` taken from the sender. */
  sent: Money;
  /** Amount of `to` given to the receiver. */
  received: Money;
}

/**
 * Postings that move money out of one wallet and into another (or the same) wallet.
 * With a conversion, the FX pool takes the other side in both currencies, so each
 * currency still balances to zero; any rounding remainder stays in the pool.
 */
export function movePostings({
  fromWalletId,
  toWalletId,
  from,
  to,
  sent,
  received,
}: Movement): Posting[] {
  const debit: Posting = {
    account: { walletId: fromWalletId, currency: from },
    amount: sent.negated(),
  };
  const credit: Posting = { account: { walletId: toWalletId, currency: to }, amount: received };
  if (from === to) return [debit, credit];
  return [
    debit,
    { account: { system: 'FX_POOL', currency: from }, amount: sent },
    { account: { system: 'FX_POOL', currency: to }, amount: received.negated() },
    credit,
  ];
}
