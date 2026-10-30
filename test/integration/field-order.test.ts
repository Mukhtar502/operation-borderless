import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { api } from '../helpers/api.js';
import { setupTestContext } from '../helpers/context.js';

// JSON field order does not change meaning, but people read these responses in Swagger
// and logs. Every endpoint returns a transaction in the same, readable order.
const { app } = setupTestContext();
const client = api(app);

const TRANSACTION_FIELDS = [
  'id',
  'type',
  'fromWalletId',
  'toWalletId',
  'source',
  'destination',
  'fx',
  'createdAt',
];

const keysOf = (body: unknown) => Object.keys((body as { data: object }).data);

describe('response field order', () => {
  it('is the same for the first response, a replay and a later lookup', async () => {
    const wallet = await client.createWallet('order@example.com');
    const body = { currency: 'cNGN', amount: '5000.50' };

    const first = await client.deposit(wallet, body, 'order-1').expect(201);
    const replay = await client.deposit(wallet, body, 'order-1').expect(201);
    const { id } = (first.body as { data: { id: string } }).data;
    const lookup = await request(app).get(`/v1/transactions/${id}`).expect(200);

    expect(keysOf(first.body)).toEqual(TRANSACTION_FIELDS);
    expect(replay.text).toBe(first.text); // byte-for-byte identical
    expect(lookup.text).toBe(first.text);
  });

  it('keeps nested fields in order for swaps and transfers', async () => {
    const ada = await client.fundedWallet('ada@example.com', 'USDx', '50');
    const kofi = await client.createWallet('kofi@example.com');

    const swap = await client
      .swap(ada, { fromCurrency: 'USDx', toCurrency: 'EURx', amount: '10' })
      .expect(201);
    const transfer = await client
      .transfer({ fromWalletId: ada, toWalletId: kofi, sourceCurrency: 'USDx', amount: '5' })
      .expect(201);

    for (const res of [swap, transfer]) {
      const data = (res.body as { data: Record<string, object> }).data;
      expect(Object.keys(data)).toEqual(TRANSACTION_FIELDS);
      expect(Object.keys(data.source ?? {})).toEqual(['currency', 'amount']);
      expect(Object.keys(data.fx ?? {})).toEqual(['rate', 'source', 'provider', 'refreshedAt']);
    }
  });

  it('puts direction next to type in history', async () => {
    const wallet = await client.fundedWallet('hist@example.com', 'USDx', '1');
    const res = await request(app).get(`/v1/wallets/${wallet}/transactions`).expect(200);
    const [item] = (res.body as { data: object[] }).data;
    expect(Object.keys(item ?? {})).toEqual([
      'id',
      'type',
      'direction',
      ...TRANSACTION_FIELDS.slice(2),
    ]);
  });
});

describe('wallet totals', () => {
  it('shows the USD total near the top of both wallet endpoints, and they agree', async () => {
    const wallet = await client.fundedWallet('total@example.com', 'cNGN', '1500');
    await client.deposit(wallet, { currency: 'USDx', amount: '2' }).expect(201);

    const summary = await request(app).get(`/v1/wallets/${wallet}`).expect(200);
    const breakdown = await request(app).get(`/v1/wallets/${wallet}/balances`).expect(200);

    expect(keysOf(summary.body)).toEqual([
      'id',
      'email',
      'phone',
      'totalUsd',
      'balances',
      'createdAt',
    ]);
    expect(keysOf(breakdown.body)).toEqual(['walletId', 'totalUsd', 'fx', 'balances']);

    const total = (body: unknown) => (body as { data: { totalUsd: string } }).data.totalUsd;
    expect(total(summary.body)).toBe('3.000000'); // 1500 cNGN = 1 USD, plus 2 USDx
    expect(total(breakdown.body)).toBe(total(summary.body));
  });
});
