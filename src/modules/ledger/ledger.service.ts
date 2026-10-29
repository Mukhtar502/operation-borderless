import type { Trx } from '../../db/client.js';
import type { Account, LedgerEntry, NewTransaction, Transaction } from '../../db/schema.js';
import { CURRENCIES, type CurrencyCode } from '../../domain/currencies.js';
import { formatAmount, Money } from '../../domain/money.js';
import { notFound, unprocessable } from '../../lib/errors.js';

export type SystemAccount = 'EXTERNAL' | 'FX_POOL';

export type AccountRef =
  { walletId: string; currency: CurrencyCode } | { system: SystemAccount; currency: CurrencyCode };

/** A signed movement: positive adds to the account balance, negative takes from it. */
export interface Posting {
  account: AccountRef;
  amount: Money;
}

export interface PostInput {
  transaction: NewTransaction;
  postings: Posting[];
}

export interface PostResult {
  transaction: Transaction;
  entries: LedgerEntry[];
}

/**
 * The only code that changes balances. Every deposit, swap and transfer becomes one
 * call to post(), inside the caller's database transaction:
 *
 * 1. Check the postings balance to zero per currency (double-entry).
 * 2. Lock every affected account row (SELECT ... FOR UPDATE), always in id order,
 *    so two concurrent posts can never deadlock waiting on each other.
 * 3. Check no wallet would go negative, with the locks held, so concurrent requests
 *    cannot both spend the same funds.
 * 4. Write the transaction, its ledger entries and the new balances.
 *
 * The database re-checks steps 1 and 3 itself (deferred trigger and CHECK constraint),
 * so a bug here fails loudly instead of corrupting balances.
 */
export class LedgerService {
  async post(trx: Trx, { transaction, postings }: PostInput): Promise<PostResult> {
    assertBalanced(postings);

    const accounts = await lockAccounts(trx, postings);
    const balances = new Map(accounts.map((a) => [a.id, new Money(a.balance)]));
    const resolved = postings.map((posting) => {
      const account = accounts.find((a) => matches(a, posting.account));
      if (!account) throw notFound('WALLET_NOT_FOUND', 'Wallet not found');
      return { account, amount: posting.amount };
    });

    const entries: { account: Account; amount: Money; balanceAfter: Money }[] = [];
    for (const { account, amount } of resolved) {
      const before = balances.get(account.id) ?? new Money(0);
      const after = before.plus(amount);
      if (account.kind === 'WALLET' && after.isNegative()) {
        throw unprocessable('INSUFFICIENT_FUNDS', `Insufficient ${account.currency} balance`, {
          currency: account.currency,
          available: formatAmount(before, account.currency),
          required: formatAmount(amount.negated(), account.currency),
        });
      }
      balances.set(account.id, after);
      entries.push({ account, amount, balanceAfter: after });
    }

    const saved = await trx
      .insertInto('transactions')
      .values(transaction)
      .returningAll()
      .executeTakeFirstOrThrow();

    const savedEntries = await trx
      .insertInto('ledger_entries')
      .values(
        entries.map(({ account, amount, balanceAfter }) => ({
          transaction_id: saved.id,
          account_id: account.id,
          amount: formatAmount(amount, account.currency),
          balance_after: formatAmount(balanceAfter, account.currency),
        })),
      )
      .returningAll()
      .execute();

    for (const account of accounts) {
      const balance = balances.get(account.id);
      if (!balance || balance.eq(account.balance)) continue;
      await trx
        .updateTable('accounts')
        .set({ balance: formatAmount(balance, account.currency), updated_at: new Date() })
        .where('id', '=', account.id)
        .execute();
    }

    return { transaction: saved, entries: savedEntries };
  }
}

function assertBalanced(postings: Posting[]): void {
  const sums = new Map<CurrencyCode, Money>();
  for (const { account, amount } of postings) {
    if (amount.isZero()) throw new Error('Ledger posting amount must not be zero');
    if (amount.decimalPlaces() > CURRENCIES[account.currency].decimals) {
      throw new Error(`Ledger posting exceeds ${account.currency} precision: ${amount.toFixed()}`);
    }
    sums.set(account.currency, (sums.get(account.currency) ?? new Money(0)).plus(amount));
  }
  for (const [currency, sum] of sums) {
    if (!sum.isZero())
      throw new Error(`Unbalanced ledger postings in ${currency}: ${sum.toFixed()}`);
  }
}

/** Finds and locks every account the postings touch, ordered by id to avoid deadlocks. */
function lockAccounts(trx: Trx, postings: Posting[]): Promise<Account[]> {
  return trx
    .selectFrom('accounts')
    .selectAll()
    .where((eb) =>
      eb.or(
        postings.map(({ account: ref }) =>
          'walletId' in ref
            ? eb.and([eb('wallet_id', '=', ref.walletId), eb('currency', '=', ref.currency)])
            : eb.and([
                eb('wallet_id', 'is', null),
                eb('kind', '=', ref.system),
                eb('currency', '=', ref.currency),
              ]),
        ),
      ),
    )
    .orderBy('id')
    .forUpdate()
    .execute();
}

function matches(account: Account, ref: AccountRef): boolean {
  if (account.currency !== ref.currency) return false;
  return 'walletId' in ref
    ? account.wallet_id === ref.walletId
    : account.wallet_id === null && account.kind === ref.system;
}
