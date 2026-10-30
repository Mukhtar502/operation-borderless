import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  ErrorResponse,
  HistoryPage,
  RatesResponse,
  TransactionResponse,
  WalletBalancesResponse,
  WalletResponse,
} from '../../src/docs/schemas.js';
import { api, type TransactionBody } from '../helpers/api.js';
import { setupTestContext } from '../helpers/context.js';

// Parses real responses with the schemas the OpenAPI document is generated from. The
// schemas are strict, so a missing, extra or wrongly typed field fails here first.
const { app } = setupTestContext();
const client = api(app);

function expectMatches(schema: z.ZodType, body: unknown) {
  const result = schema.safeParse(body);
  expect(result.error?.issues ?? []).toEqual([]);
}

describe('responses match the documented schemas', () => {
  it('wallets and balances', async () => {
    const created = await request(app)
      .post('/v1/wallets')
      .send({ email: 'doc@example.com', phone: '+233241234567' })
      .expect(201);
    expectMatches(WalletResponse, created.body);

    const id = (created.body as { data: { id: string } }).data.id;
    expectMatches(WalletResponse, (await request(app).get(`/v1/wallets/${id}`)).body);
    expectMatches(
      WalletBalancesResponse,
      (await request(app).get(`/v1/wallets/${id}/balances`)).body,
    );
  });

  it('deposits, swaps, transfers, history and lookup', async () => {
    const ada = await client.createWallet('ada@example.com');
    const kofi = await client.createWallet('kofi@example.com');

    const deposit = await client.deposit(ada, { currency: 'USDx', amount: '100' }).expect(201);
    expectMatches(TransactionResponse, deposit.body);

    const swap = await client
      .swap(ada, { fromCurrency: 'USDx', toCurrency: 'cXAF', amount: '10' })
      .expect(201);
    expectMatches(TransactionResponse, swap.body);

    const transfer = await client
      .transfer({
        fromWalletId: ada,
        toWalletId: kofi,
        sourceCurrency: 'USDx',
        destinationCurrency: 'EURx',
        amount: '5',
      })
      .expect(201);
    expectMatches(TransactionResponse, transfer.body);

    const history = await request(app).get(`/v1/wallets/${ada}/transactions?limit=2`).expect(200);
    expectMatches(HistoryPage, history.body);

    const { id } = (transfer.body as TransactionBody).data;
    expectMatches(TransactionResponse, (await request(app).get(`/v1/transactions/${id}`)).body);
  });

  it('rates', async () => {
    expectMatches(RatesResponse, (await request(app).get('/v1/rates').expect(200)).body);
  });

  it('errors', async () => {
    const ada = await client.createWallet('err@example.com');
    const responses = await Promise.all([
      request(app).post('/v1/wallets').send({}),
      request(app).get('/v1/wallets/00000000-0000-4000-8000-000000000000'),
      client.swap(ada, { fromCurrency: 'USDx', toCurrency: 'EURx', amount: '1' }),
      request(app).post('/v1/wallets').send({ email: 'err@example.com' }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([400, 404, 422, 409]);
    for (const res of responses) expectMatches(ErrorResponse, res.body);
  });
});

describe('API docs', () => {
  it('serves the OpenAPI document and Swagger UI', async () => {
    const spec = await request(app).get('/docs/openapi.json').expect(200);
    expect((spec.body as { openapi: string }).openapi).toBe('3.1.0');

    const ui = await request(app).get('/docs/').expect(200);
    expect(ui.text).toContain('swagger-ui');
  });
});
