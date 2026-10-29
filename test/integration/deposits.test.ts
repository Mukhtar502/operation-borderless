import { describe, expect, it } from 'vitest';
import { api, type ErrorBody, type TransactionBody } from '../helpers/api.js';
import { setupTestContext } from '../helpers/context.js';
import { expectLedgerConsistent } from '../helpers/ledger.js';

const { app, db } = setupTestContext();
const client = api(app);

describe('POST /v1/wallets/:walletId/deposits', () => {
  it('credits the wallet at once and records the transaction', async () => {
    const wallet = await client.createWallet('dep@example.com');
    const res = await client.deposit(wallet, { currency: 'cNGN', amount: '5000.50' }).expect(201);
    const { data } = res.body as TransactionBody;

    expect(res.headers['idempotent-replayed']).toBe('false');
    expect(data).toMatchObject({
      type: 'DEPOSIT',
      fromWalletId: null,
      toWalletId: wallet,
      source: { currency: 'cNGN', amount: '5000.500000' },
      destination: { currency: 'cNGN', amount: '5000.500000' },
      fx: { rate: '1', source: 'par', provider: null },
    });
    expect(await client.balance(wallet, 'cNGN')).toBe('5000.500000');
    await expectLedgerConsistent(db);
  });

  it('replays a retry with the same key without crediting twice', async () => {
    const wallet = await client.createWallet('retry@example.com');
    const body = { currency: 'USDx', amount: '25' };
    const first = await client.deposit(wallet, body, 'dep-key-1').expect(201);
    const retry = await client.deposit(wallet, body, 'dep-key-1').expect(201);

    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body).toEqual(first.body);
    expect(await client.balance(wallet, 'USDx')).toBe('25.000000');
  });

  it('treats "25" and "25.00" as the same request', async () => {
    const wallet = await client.createWallet('same@example.com');
    await client.deposit(wallet, { currency: 'USDx', amount: '25' }, 'k').expect(201);
    const retry = await client.deposit(wallet, { currency: 'USDx', amount: '25.00' }, 'k');
    expect(retry.headers['idempotent-replayed']).toBe('true');
  });

  it('rejects the same key with a different amount', async () => {
    const wallet = await client.createWallet('reuse@example.com');
    await client.deposit(wallet, { currency: 'USDx', amount: '25' }, 'k').expect(201);
    const res = await client.deposit(wallet, { currency: 'USDx', amount: '26' }, 'k').expect(422);
    expect((res.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await client.balance(wallet, 'USDx')).toBe('25.000000');
  });

  it('adds up many concurrent deposits exactly', async () => {
    const wallet = await client.createWallet('many@example.com');
    await Promise.all(
      Array.from({ length: 20 }, () =>
        client.deposit(wallet, { currency: 'EURx', amount: '0.10' }).expect(201),
      ),
    );
    expect(await client.balance(wallet, 'EURx')).toBe('2.000000');
    await expectLedgerConsistent(db);
  });

  it('requires an Idempotency-Key header', async () => {
    const wallet = await client.createWallet('nokey@example.com');
    const res = await client.deposit(wallet, { currency: 'USDx', amount: '1' }, null).expect(400);
    expect((res.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it.each([
    ['a JSON number', { currency: 'USDx', amount: 10 }, 'VALIDATION_ERROR'],
    ['an unknown currency', { currency: 'BTC', amount: '10' }, 'VALIDATION_ERROR'],
    ['a negative amount', { currency: 'USDx', amount: '-10' }, 'INVALID_AMOUNT'],
    ['zero', { currency: 'USDx', amount: '0' }, 'INVALID_AMOUNT'],
    ['too many decimals', { currency: 'USDx', amount: '1.1234567' }, 'INVALID_AMOUNT'],
    ['extra fields', { currency: 'USDx', amount: '1', fee: '0' }, 'VALIDATION_ERROR'],
  ])('rejects %s with 400', async (_label, body, code) => {
    const wallet = await client.createWallet('bad@example.com');
    const res = await client.deposit(wallet, body).expect(400);
    expect((res.body as ErrorBody).error.code).toBe(code);
    expect(await client.balance(wallet, 'USDx')).toBe('0.000000');
  });

  it('returns 404 for an unknown wallet', async () => {
    const res = await client
      .deposit('00000000-0000-4000-8000-000000000000', { currency: 'USDx', amount: '1' })
      .expect(404);
    expect((res.body as ErrorBody).error.code).toBe('WALLET_NOT_FOUND');
  });

  it('keeps total supply in the EXTERNAL account', async () => {
    const a = await client.createWallet('supply-a@example.com');
    const b = await client.createWallet('supply-b@example.com');
    await client.deposit(a, { currency: 'cGHS', amount: '100' }).expect(201);
    await client.deposit(b, { currency: 'cGHS', amount: '50.25' }).expect(201);

    const external = await db
      .selectFrom('accounts')
      .select('balance')
      .where('kind', '=', 'EXTERNAL')
      .where('currency', '=', 'cGHS')
      .executeTakeFirstOrThrow();
    expect(external.balance).toBe('-150.250000');
  });
});
