import { describe, expect, it } from 'vitest';
import { api, type ErrorBody, type TransactionBody } from '../helpers/api.js';
import { setupTestContext } from '../helpers/context.js';
import { expectLedgerConsistent } from '../helpers/ledger.js';

// Test rates per 1 USD: NGN 1500, GHS 15, XAF 600, EUR 0.8
const { app, db } = setupTestContext();
const client = api(app);
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('POST /v1/transfers', () => {
  it('sends money in the same currency', async () => {
    const ada = await client.fundedWallet('ada@example.com', 'cNGN', '10000');
    const kofi = await client.createWallet('kofi@example.com');

    const res = await client
      .transfer({ fromWalletId: ada, toWalletId: kofi, sourceCurrency: 'cNGN', amount: '2500' })
      .expect(201);
    const { data } = res.body as TransactionBody;

    expect(data).toMatchObject({
      type: 'TRANSFER',
      fromWalletId: ada,
      toWalletId: kofi,
      source: { currency: 'cNGN', amount: '2500.000000' },
      destination: { currency: 'cNGN', amount: '2500.000000' },
      fx: { rate: '1', source: 'par', provider: null },
    });
    expect(await client.balance(ada, 'cNGN')).toBe('7500.000000');
    expect(await client.balance(kofi, 'cNGN')).toBe('2500.000000');
    await expectLedgerConsistent(db);
  });

  it('converts automatically when the currencies differ', async () => {
    const ada = await client.fundedWallet('ada@example.com', 'USDx', '100');
    const kofi = await client.createWallet('kofi@example.com');

    const res = await client
      .transfer({
        fromWalletId: ada,
        toWalletId: kofi,
        sourceCurrency: 'USDx',
        destinationCurrency: 'cGHS',
        amount: '20',
      })
      .expect(201);
    const { data } = res.body as TransactionBody;

    // Everything the brief asks a transfer record to hold.
    expect(data.fromWalletId).toBe(ada);
    expect(data.toWalletId).toBe(kofi);
    expect(data.source).toEqual({ currency: 'USDx', amount: '20.000000' });
    expect(data.destination).toEqual({ currency: 'cGHS', amount: '300.000000' });
    expect(data.fx).toMatchObject({ rate: '15', source: 'live', provider: 'fake-fx' });
    expect(Number.isNaN(Date.parse(data.createdAt))).toBe(false);

    expect(await client.balance(ada, 'USDx')).toBe('80.000000');
    expect(await client.balance(kofi, 'cGHS')).toBe('300.000000');
    expect(await client.balance(kofi, 'USDx')).toBe('0.000000');
    await expectLedgerConsistent(db);
  });

  it('rejects a transfer larger than the balance and moves nothing', async () => {
    const ada = await client.fundedWallet('ada@example.com', 'EURx', '5');
    const kofi = await client.createWallet('kofi@example.com');

    const res = await client
      .transfer({ fromWalletId: ada, toWalletId: kofi, sourceCurrency: 'EURx', amount: '6' })
      .expect(422);
    expect((res.body as ErrorBody).error.code).toBe('INSUFFICIENT_FUNDS');
    expect(await client.balance(ada, 'EURx')).toBe('5.000000');
    expect(await client.balance(kofi, 'EURx')).toBe('0.000000');
  });

  it('never lets concurrent transfers overspend', async () => {
    const ada = await client.fundedWallet('ada@example.com', 'USDx', '50');
    const receivers = await Promise.all(
      Array.from({ length: 4 }, (_, i) => client.createWallet(`r${i}@example.com`)),
    );

    const results = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        client.transfer({
          fromWalletId: ada,
          toWalletId: receivers[i % 4],
          sourceCurrency: 'USDx',
          amount: '5',
        }),
      ),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    expect(results.filter((r) => r.status === 422)).toHaveLength(6);
    expect(await client.balance(ada, 'USDx')).toBe('0.000000');
    await expectLedgerConsistent(db);
  });

  it('does not deadlock when two wallets send to each other at the same time', async () => {
    const ada = await client.fundedWallet('ada@example.com', 'USDx', '100');
    const kofi = await client.fundedWallet('kofi@example.com', 'USDx', '100');

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        client.transfer({
          fromWalletId: i % 2 ? ada : kofi,
          toWalletId: i % 2 ? kofi : ada,
          sourceCurrency: 'USDx',
          amount: '1',
        }),
      ),
    );

    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await client.balance(ada, 'USDx')).toBe('100.000000');
    expect(await client.balance(kofi, 'USDx')).toBe('100.000000');
    await expectLedgerConsistent(db);
  });

  it('replays a retry without sending twice', async () => {
    const ada = await client.fundedWallet('ada@example.com', 'USDx', '30');
    const kofi = await client.createWallet('kofi@example.com');
    const body = { fromWalletId: ada, toWalletId: kofi, sourceCurrency: 'USDx', amount: '10' };

    const first = await client.transfer(body, 'tx-1').expect(201);
    const retry = await client.transfer(body, 'tx-1').expect(201);

    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body).toEqual(first.body);
    expect(await client.balance(kofi, 'USDx')).toBe('10.000000');
  });

  it('rejects sending to yourself', async () => {
    const ada = await client.fundedWallet('ada@example.com', 'USDx', '10');
    const res = await client
      .transfer({ fromWalletId: ada, toWalletId: ada, sourceCurrency: 'USDx', amount: '1' })
      .expect(400);
    expect((res.body as ErrorBody).error.code).toBe('SAME_WALLET');
  });

  it('says which wallet is missing and moves nothing', async () => {
    const ada = await client.fundedWallet('ada@example.com', 'USDx', '10');

    const toUnknown = await client
      .transfer({ fromWalletId: ada, toWalletId: UNKNOWN, sourceCurrency: 'USDx', amount: '1' })
      .expect(404);
    expect((toUnknown.body as ErrorBody).error.message).toBe('Receiver wallet not found');
    expect(await client.balance(ada, 'USDx')).toBe('10.000000');

    const fromUnknown = await client
      .transfer({ fromWalletId: UNKNOWN, toWalletId: ada, sourceCurrency: 'USDx', amount: '1' })
      .expect(404);
    expect((fromUnknown.body as ErrorBody).error.message).toBe('Sender wallet not found');
  });

  it('rejects malformed wallet ids', async () => {
    await client
      .transfer({ fromWalletId: 'abc', toWalletId: UNKNOWN, sourceCurrency: 'USDx', amount: '1' })
      .expect(400);
  });
});
