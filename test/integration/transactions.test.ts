import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { encodeCursor } from '../../src/modules/transactions/transaction.service.js';
import { api, type ErrorBody, type TransactionBody } from '../helpers/api.js';
import { setupTestContext } from '../helpers/context.js';

const { app } = setupTestContext();
const client = api(app);

interface HistoryBody {
  data: (TransactionBody['data'] & { direction: string })[];
  pagination: { limit: number; hasMore: boolean; nextCursor: string | null };
}

const history = async (walletId: string, query = '') => {
  const res = await request(app).get(`/v1/wallets/${walletId}/transactions${query}`).expect(200);
  return res.body as HistoryBody;
};

/** Ada deposits, swaps, sends to Kofi and receives from Kofi. */
async function busyWallets() {
  const ada = await client.fundedWallet('ada@example.com', 'USDx', '100');
  const kofi = await client.fundedWallet('kofi@example.com', 'cGHS', '1000');
  await client.swap(ada, { fromCurrency: 'USDx', toCurrency: 'cNGN', amount: '10' }).expect(201);
  await client
    .transfer({ fromWalletId: ada, toWalletId: kofi, sourceCurrency: 'USDx', amount: '5' })
    .expect(201);
  await client
    .transfer({
      fromWalletId: kofi,
      toWalletId: ada,
      sourceCurrency: 'cGHS',
      destinationCurrency: 'EURx',
      amount: '150',
    })
    .expect(201);
  return { ada, kofi };
}

describe('GET /v1/wallets/:walletId/transactions', () => {
  it('lists deposits, swaps and transfers sent and received, newest first', async () => {
    const { ada } = await busyWallets();
    const { data } = await history(ada);

    expect(data.map((t) => [t.type, t.direction])).toEqual([
      ['TRANSFER', 'IN'],
      ['TRANSFER', 'OUT'],
      ['SWAP', 'INTERNAL'],
      ['DEPOSIT', 'IN'],
    ]);
    const times = data.map((t) => Date.parse(t.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("shows only the wallet's own transactions", async () => {
    const { kofi } = await busyWallets();
    const outsider = await client.fundedWallet('outsider@example.com', 'USDx', '1');
    const { data } = await history(kofi);

    expect(data).toHaveLength(3);
    expect(data.every((t) => t.fromWalletId === kofi || t.toWalletId === kofi)).toBe(true);
    expect((await history(outsider)).data).toHaveLength(1);
  });

  it('filters by type', async () => {
    const { ada } = await busyWallets();
    const { data } = await history(ada, '?type=TRANSFER');
    expect(data.map((t) => t.direction)).toEqual(['IN', 'OUT']);
  });

  it('filters by currency on either side of the transaction', async () => {
    const { ada } = await busyWallets();
    // cNGN only appears as the destination of the swap.
    expect((await history(ada, '?currency=cNGN')).data.map((t) => t.type)).toEqual(['SWAP']);
    // USDx: deposit, swap source and transfer sent.
    expect((await history(ada, '?currency=USDx')).data).toHaveLength(3);
    expect((await history(ada, '?type=TRANSFER&currency=EURx')).data).toHaveLength(1);
  });

  it('pages through history with a cursor, without gaps or repeats', async () => {
    const wallet = await client.createWallet('pages@example.com');
    for (let i = 1; i <= 5; i++) {
      await client.deposit(wallet, { currency: 'USDx', amount: String(i) }).expect(201);
    }

    const seen: string[] = [];
    let page = await history(wallet, '?limit=2');
    seen.push(...page.data.map((t) => t.source.amount));
    expect(page.pagination).toMatchObject({ limit: 2, hasMore: true });

    while (page.pagination.nextCursor) {
      page = await history(wallet, `?limit=2&cursor=${page.pagination.nextCursor}`);
      seen.push(...page.data.map((t) => t.source.amount));
    }

    expect(seen).toEqual(['5.000000', '4.000000', '3.000000', '2.000000', '1.000000']);
    expect(page.pagination).toEqual({ limit: 2, hasMore: false, nextCursor: null });
  });

  it('keeps pages stable when new transactions arrive between requests', async () => {
    const wallet = await client.createWallet('stable@example.com');
    for (let i = 1; i <= 4; i++) {
      await client.deposit(wallet, { currency: 'USDx', amount: String(i) }).expect(201);
    }

    const first = await history(wallet, '?limit=2');
    await client.deposit(wallet, { currency: 'USDx', amount: '99' }).expect(201);
    const second = await history(wallet, `?limit=2&cursor=${String(first.pagination.nextCursor)}`);

    expect(first.data.map((t) => t.source.amount)).toEqual(['4.000000', '3.000000']);
    expect(second.data.map((t) => t.source.amount)).toEqual(['2.000000', '1.000000']);
  });

  it.each([
    ['a limit above 100', '?limit=101', 'VALIDATION_ERROR'],
    ['a limit of 0', '?limit=0', 'VALIDATION_ERROR'],
    ['an unknown type', '?type=REFUND', 'VALIDATION_ERROR'],
    ['an unknown currency', '?currency=BTC', 'VALIDATION_ERROR'],
    ['an unknown query parameter', '?page=2', 'VALIDATION_ERROR'],
    ['a garbage cursor', '?cursor=not-a-cursor', 'INVALID_CURSOR'],
    [
      'a cursor for a missing transaction',
      `?cursor=${encodeCursor(crypto.randomUUID())}`,
      'INVALID_CURSOR',
    ],
  ])('rejects %s with 400', async (_label, query, code) => {
    const wallet = await client.createWallet('bad-query@example.com');
    const res = await request(app).get(`/v1/wallets/${wallet}/transactions${query}`).expect(400);
    expect((res.body as ErrorBody).error.code).toBe(code);
  });

  it('returns 404 for an unknown wallet', async () => {
    await request(app)
      .get('/v1/wallets/00000000-0000-4000-8000-000000000000/transactions')
      .expect(404);
  });
});

describe('GET /v1/transactions/:transactionId', () => {
  it('returns a single transaction', async () => {
    const wallet = await client.createWallet('one@example.com');
    const created = await client.deposit(wallet, { currency: 'cXAF', amount: '600' }).expect(201);
    const { id } = (created.body as TransactionBody).data;

    const res = await request(app).get(`/v1/transactions/${id}`).expect(200);
    expect(res.body).toEqual(created.body);
  });

  it('returns 404 for an unknown transaction and 400 for a malformed id', async () => {
    const res = await request(app)
      .get('/v1/transactions/00000000-0000-4000-8000-000000000000')
      .expect(404);
    expect((res.body as ErrorBody).error.code).toBe('TRANSACTION_NOT_FOUND');
    await request(app).get('/v1/transactions/123').expect(400);
  });
});
