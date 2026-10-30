import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { CurrencyCode } from '../../src/domain/currencies.js';
import { createApp } from '../../src/app.js';
import { FxService } from '../../src/modules/rates/fx.service.js';
import { setupTestContext, testLogger } from '../helpers/context.js';
import { FakeFxProvider } from '../helpers/fake-fx.js';

const { app, db } = setupTestContext();

interface BalancesBody {
  data: {
    walletId: string;
    balances: { currency: string; amount: string; usdValue: string }[];
    totalUsd: string;
    fx: { source: string; provider: string; refreshedAt: string };
  };
}

async function createWallet(email: string): Promise<string> {
  const res = await request(app).post('/v1/wallets').send({ email }).expect(201);
  return (res.body as { data: { id: string } }).data.id;
}

// Deposits arrive in a later step; until then tests set balances directly.
async function setBalance(walletId: string, currency: CurrencyCode, amount: string) {
  await db
    .updateTable('accounts')
    .set({ balance: amount })
    .where('wallet_id', '=', walletId)
    .where('currency', '=', currency)
    .execute();
}

describe('GET /v1/wallets/:walletId/balances', () => {
  it('returns zero balances and a zero total for a new wallet', async () => {
    const id = await createWallet('new@example.com');
    const res = await request(app).get(`/v1/wallets/${id}/balances`).expect(200);
    const { data } = res.body as BalancesBody;

    expect(data.walletId).toBe(id);
    expect(data.balances).toHaveLength(5);
    expect(data.totalUsd).toBe('0.000000');
  });

  it('values every balance in USD and adds them up', async () => {
    const id = await createWallet('rich@example.com');
    // Test rates per 1 USD: NGN 1500, GHS 15, XAF 600, EUR 0.8
    await setBalance(id, 'cNGN', '1500');
    await setBalance(id, 'cGHS', '30');
    await setBalance(id, 'cXAF', '300');
    await setBalance(id, 'USDx', '10.25');
    await setBalance(id, 'EURx', '8');

    const res = await request(app).get(`/v1/wallets/${id}/balances`).expect(200);
    const { data } = res.body as BalancesBody;

    expect(data.balances).toEqual([
      { currency: 'cNGN', amount: '1500.000000', usdValue: '1.000000' },
      { currency: 'cGHS', amount: '30.000000', usdValue: '2.000000' },
      { currency: 'cXAF', amount: '300.000000', usdValue: '0.500000' },
      { currency: 'USDx', amount: '10.250000', usdValue: '10.250000' },
      { currency: 'EURx', amount: '8.000000', usdValue: '10.000000' },
    ]);
    expect(data.totalUsd).toBe('23.750000');
    expect(data.fx).toMatchObject({ source: 'live', provider: 'fake-fx' });
  });

  it('total always equals the sum of the lines, even with rounding', async () => {
    const id = await createWallet('round@example.com');
    await setBalance(id, 'cNGN', '1'); // 1/1500 = 0.000666... USD
    await setBalance(id, 'cXAF', '1'); // 1/600  = 0.001666... USD

    const res = await request(app).get(`/v1/wallets/${id}/balances`).expect(200);
    const { data } = res.body as BalancesBody;
    const sum = data.balances.reduce((acc, b) => acc + Math.round(Number(b.usdValue) * 1e6), 0);

    expect(data.balances[0]?.usdValue).toBe('0.000667');
    expect(data.balances[2]?.usdValue).toBe('0.001667');
    expect(Math.round(Number(data.totalUsd) * 1e6)).toBe(sum);
  });

  it('still answers, and says so, when the FX provider is down', async () => {
    const provider = new FakeFxProvider();
    provider.failing = true;
    const downApp = createApp({
      db,
      logger: testLogger,
      fx: new FxService(provider, testLogger, { cacheTtlMs: 60_000 }),
    });
    const id = await createWallet('offline@example.com');

    const res = await request(downApp).get(`/v1/wallets/${id}/balances`).expect(200);
    expect((res.body as BalancesBody).data.fx.source).toBe('static');
  });

  it('returns 404 for an unknown wallet', async () => {
    await request(app).get('/v1/wallets/00000000-0000-4000-8000-000000000000/balances').expect(404);
  });
});
