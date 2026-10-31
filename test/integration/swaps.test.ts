import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { Money } from '../../src/domain/money.js';
import { FxService } from '../../src/modules/rates/fx.service.js';
import { api, type ErrorBody, type TransactionBody } from '../helpers/api.js';
import { setupTestContext, testLogger } from '../helpers/context.js';
import { FakeFxProvider } from '../helpers/fake-fx.js';
import { expectLedgerConsistent } from '../helpers/ledger.js';

// Test rates per 1 USD: NGN 1500, GHS 15, XAF 600, EUR 0.8
const { app, db } = setupTestContext();
const client = api(app);

describe('POST /v1/wallets/:walletId/swaps', () => {
  it('converts at the current rate and records the rate used', async () => {
    const wallet = await client.fundedWallet('swap@example.com', 'USDx', '100');
    const res = await client
      .swap(wallet, { fromCurrency: 'USDx', toCurrency: 'cNGN', amount: '40' })
      .expect(201);
    const { data } = res.body as TransactionBody;

    expect(data).toMatchObject({
      type: 'SWAP',
      fromWalletId: wallet,
      toWalletId: wallet,
      source: { currency: 'USDx', amount: '40.000000' },
      destination: { currency: 'cNGN', amount: '60000.000000' },
      fx: { rate: '1500', source: 'live', provider: 'fake-fx' },
    });
    expect(await client.balance(wallet, 'USDx')).toBe('60.000000');
    expect(await client.balance(wallet, 'cNGN')).toBe('60000.000000');
    await expectLedgerConsistent(db);
  });

  it('rounds the received amount down, so a swap never creates money', async () => {
    const wallet = await client.fundedWallet('round@example.com', 'cNGN', '1');
    // 1 cNGN = 1/1500 USDx = 0.000666666... -> 0.000666
    const res = await client
      .swap(wallet, { fromCurrency: 'cNGN', toCurrency: 'USDx', amount: '1' })
      .expect(201);
    const { data } = res.body as TransactionBody;

    expect(data.destination.amount).toBe('0.000666');
    // The recorded rate reproduces the recorded amount exactly.
    expect(new Money(data.source.amount).times(data.fx.rate).toDecimalPlaces(6).toFixed(6)).toBe(
      data.destination.amount,
    );
    await expectLedgerConsistent(db);
  });

  it('rejects a swap larger than the balance and changes nothing', async () => {
    const wallet = await client.fundedWallet('poor@example.com', 'EURx', '10');
    const res = await client
      .swap(wallet, { fromCurrency: 'EURx', toCurrency: 'USDx', amount: '10.01' })
      .expect(422);

    expect((res.body as ErrorBody).error).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      details: { currency: 'EURx', available: '10.000000', required: '10.010000' },
    });
    expect(await client.balance(wallet, 'EURx')).toBe('10.000000');
    expect(await client.balance(wallet, 'USDx')).toBe('0.000000');
  });

  it('never lets concurrent swaps spend more than the balance', async () => {
    const wallet = await client.fundedWallet('race@example.com', 'USDx', '100');
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        client.swap(wallet, { fromCurrency: 'USDx', toCurrency: 'EURx', amount: '20' }),
      ),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 422)).toHaveLength(7);
    expect(await client.balance(wallet, 'USDx')).toBe('0.000000');
    expect(await client.balance(wallet, 'EURx')).toBe('80.000000');
    await expectLedgerConsistent(db);
  });

  it('replays a retry without swapping twice', async () => {
    const wallet = await client.fundedWallet('retry@example.com', 'USDx', '50');
    const body = { fromCurrency: 'USDx', toCurrency: 'cGHS', amount: '10' };
    const first = await client.swap(wallet, body, 'swap-1').expect(201);
    const retry = await client.swap(wallet, body, 'swap-1').expect(201);

    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body).toEqual(first.body);
    expect(await client.balance(wallet, 'USDx')).toBe('40.000000');
    expect(await client.balance(wallet, 'cGHS')).toBe('150.000000');
  });

  it('rejects swapping a currency into itself', async () => {
    const wallet = await client.fundedWallet('same@example.com', 'USDx', '5');
    const res = await client
      .swap(wallet, { fromCurrency: 'USDx', toCurrency: 'USDx', amount: '1' })
      .expect(400);
    expect((res.body as ErrorBody).error.code).toBe('SAME_CURRENCY');
  });

  it('rejects an amount worth less than one unit of the target currency', async () => {
    const wallet = await client.fundedWallet('tiny@example.com', 'cNGN', '1');
    const res = await client
      .swap(wallet, { fromCurrency: 'cNGN', toCurrency: 'USDx', amount: '0.000001' })
      .expect(422);
    expect((res.body as ErrorBody).error.code).toBe('AMOUNT_TOO_SMALL');
    expect(await client.balance(wallet, 'cNGN')).toBe('1.000000');
  });

  it('still works on fallback rates when the FX provider is down, and says so', async () => {
    const provider = new FakeFxProvider();
    provider.failing = true;
    const downApp = createApp({
      db,
      logger: testLogger,
      fx: new FxService(provider, testLogger, { cacheTtlMs: 60_000 }),
    });
    const down = api(downApp);
    const wallet = await down.fundedWallet('offline@example.com', 'USDx', '10');

    const res = await down
      .swap(wallet, { fromCurrency: 'USDx', toCurrency: 'EURx', amount: '10' })
      .expect(201);
    const { data } = res.body as TransactionBody;
    expect(data.fx).toMatchObject({ source: 'static', provider: 'static-table' });
    expect(data.destination.amount).toBe('8.972150'); // static EUR rate is 0.897215
  });

  it('returns 404 for an unknown wallet', async () => {
    await client
      .swap('00000000-0000-4000-8000-000000000000', {
        fromCurrency: 'USDx',
        toCurrency: 'EURx',
        amount: '1',
      })
      .expect(404);
  });
});
