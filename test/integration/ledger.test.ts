import request from 'supertest';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { NewTransaction } from '../../src/db/schema.js';
import type { CurrencyCode } from '../../src/domain/currencies.js';
import { Money } from '../../src/domain/money.js';
import { AppError } from '../../src/lib/errors.js';
import { LedgerService, type Posting } from '../../src/modules/ledger/ledger.service.js';
import { setupTestContext } from '../helpers/context.js';
import { expectLedgerConsistent } from '../helpers/ledger.js';

const { app, db } = setupTestContext();
const ledger = new LedgerService();

async function createWallet(email: string): Promise<string> {
  const res = await request(app).post('/v1/wallets').send({ email }).expect(201);
  return (res.body as { data: { id: string } }).data.id;
}

function depositRecord(walletId: string, currency: CurrencyCode, amount: string): NewTransaction {
  return {
    type: 'DEPOSIT',
    from_wallet_id: null,
    to_wallet_id: walletId,
    source_currency: currency,
    source_amount: amount,
    destination_currency: currency,
    destination_amount: amount,
    fx_rate: '1',
    fx_rate_source: 'par',
    fx_rate_fetched_at: new Date(),
    idempotency_key: null,
  };
}

function deposit(walletId: string, currency: CurrencyCode, amount: string) {
  return db.transaction().execute((trx) =>
    ledger.post(trx, {
      transaction: depositRecord(walletId, currency, amount),
      postings: [
        { account: { system: 'EXTERNAL', currency }, amount: new Money(amount).negated() },
        { account: { walletId, currency }, amount: new Money(amount) },
      ],
    }),
  );
}

// A same-currency move between two wallets, used to exercise debits.
function move(from: string, to: string, amount: string) {
  const postings: Posting[] = [
    { account: { walletId: from, currency: 'USDx' }, amount: new Money(amount).negated() },
    { account: { walletId: to, currency: 'USDx' }, amount: new Money(amount) },
  ];
  return db.transaction().execute((trx) =>
    ledger.post(trx, {
      transaction: {
        ...depositRecord(to, 'USDx', amount),
        type: 'TRANSFER',
        from_wallet_id: from,
      },
      postings,
    }),
  );
}

async function balanceOf(walletId: string, currency: CurrencyCode): Promise<string> {
  const row = await db
    .selectFrom('accounts')
    .select('balance')
    .where('wallet_id', '=', walletId)
    .where('currency', '=', currency)
    .executeTakeFirstOrThrow();
  return row.balance;
}

describe('LedgerService.post', () => {
  it('writes the transaction, balanced entries and new balances', async () => {
    const wallet = await createWallet('ledger@example.com');
    const { transaction, entries } = await deposit(wallet, 'USDx', '100.50');

    expect(transaction.type).toBe('DEPOSIT');
    expect(entries.map((e) => e.amount).sort()).toEqual(['-100.500000', '100.500000']);
    expect(await balanceOf(wallet, 'USDx')).toBe('100.500000');

    const second = await deposit(wallet, 'USDx', '0.5');
    const walletEntry = second.entries.find((e) => e.amount === '0.500000');
    expect(walletEntry?.balance_after).toBe('101.000000');

    await expectLedgerConsistent(db);
  });

  it('rejects an overdraft with 422 and writes nothing', async () => {
    const alice = await createWallet('alice@example.com');
    const bob = await createWallet('bob@example.com');
    await deposit(alice, 'USDx', '10');

    const error = await move(alice, bob, '10.000001').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      status: 422,
      code: 'INSUFFICIENT_FUNDS',
      details: { currency: 'USDx', available: '10.000000', required: '10.000001' },
    });

    expect(await balanceOf(alice, 'USDx')).toBe('10.000000');
    expect(await balanceOf(bob, 'USDx')).toBe('0.000000');
    const count = await db
      .selectFrom('transactions')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    expect(count.n).toBe('1');
  });

  it('refuses postings that do not balance before touching the database', async () => {
    const wallet = await createWallet('unbalanced@example.com');
    await expect(
      db.transaction().execute((trx) =>
        ledger.post(trx, {
          transaction: depositRecord(wallet, 'USDx', '5'),
          postings: [{ account: { walletId: wallet, currency: 'USDx' }, amount: new Money('5') }],
        }),
      ),
    ).rejects.toThrow(/Unbalanced ledger postings in USDx/);
  });

  it('never lets concurrent debits overspend', async () => {
    const alice = await createWallet('race-a@example.com');
    const bob = await createWallet('race-b@example.com');
    await deposit(alice, 'USDx', '100');

    // 25 parallel debits of 10 against a balance of 100: exactly 10 may succeed.
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, () => move(alice, bob, '10')),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter(
      (r) => r.status === 'rejected' && (r.reason as AppError).code === 'INSUFFICIENT_FUNDS',
    ).length;

    expect(ok).toBe(10);
    expect(rejected).toBe(15);
    expect(await balanceOf(alice, 'USDx')).toBe('0.000000');
    expect(await balanceOf(bob, 'USDx')).toBe('100.000000');
    await expectLedgerConsistent(db);
  });

  it('does not deadlock when two wallets pay each other at the same time', async () => {
    const alice = await createWallet('dl-a@example.com');
    const bob = await createWallet('dl-b@example.com');
    await deposit(alice, 'USDx', '100');
    await deposit(bob, 'USDx', '100');

    await Promise.all(
      Array.from({ length: 20 }, (_, i) => (i % 2 ? move(alice, bob, '1') : move(bob, alice, '1'))),
    );

    expect(await balanceOf(alice, 'USDx')).toBe('100.000000');
    expect(await balanceOf(bob, 'USDx')).toBe('100.000000');
    await expectLedgerConsistent(db);
  });
});

describe('database guards', () => {
  it('rejects ledger entries that do not balance, even if code is bypassed', async () => {
    const wallet = await createWallet('guard@example.com');
    const account = await db
      .selectFrom('accounts')
      .select('id')
      .where('wallet_id', '=', wallet)
      .where('currency', '=', 'USDx')
      .executeTakeFirstOrThrow();

    await expect(
      db.transaction().execute(async (trx) => {
        const tx = await trx
          .insertInto('transactions')
          .values(depositRecord(wallet, 'USDx', '5'))
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('ledger_entries')
          .values({
            transaction_id: tx.id,
            account_id: account.id,
            amount: '5',
            balance_after: '5',
          })
          .execute();
      }),
    ).rejects.toThrow(/unbalanced ledger/);
  });

  it('rejects edits to ledger entries', async () => {
    const wallet = await createWallet('immutable@example.com');
    await deposit(wallet, 'USDx', '5');
    await expect(sql`UPDATE ledger_entries SET amount = 1`.execute(db)).rejects.toThrow(
      /append-only/,
    );
    await expect(sql`DELETE FROM ledger_entries`.execute(db)).rejects.toThrow(/append-only/);
  });

  it('rejects a negative wallet balance, even if code is bypassed', async () => {
    const wallet = await createWallet('negative@example.com');
    await expect(
      db.updateTable('accounts').set({ balance: '-1' }).where('wallet_id', '=', wallet).execute(),
    ).rejects.toThrow(/accounts_wallet_non_negative/);
  });
});
