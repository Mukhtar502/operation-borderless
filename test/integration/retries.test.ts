import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { FxService } from '../../src/modules/rates/fx.service.js';
import { api, type ErrorBody } from '../helpers/api.js';
import { setupTestContext, testLogger } from '../helpers/context.js';
import { FakeFxProvider } from '../helpers/fake-fx.js';

const { db } = setupTestContext();

/** An app that asks the provider for rates on every request, so rate changes show at once. */
function uncachedApp() {
  const provider = new FakeFxProvider();
  const fx = new FxService(provider, testLogger, { cacheTtlMs: 0, retryBackoffMs: 0 });
  return { provider, client: api(createApp({ db, logger: testLogger, fx })) };
}

const swap = { fromCurrency: 'cNGN', toCurrency: 'USDx', amount: '0.01' };

describe('retrying a request that already succeeded', () => {
  it('replays the first result even if the rate has since made the amount too small', async () => {
    const { provider, client } = uncachedApp();
    const wallet = await client.fundedWallet('rate-moved@example.com', 'cNGN', '1');
    const first = await client.swap(wallet, swap, 'retry-1').expect(201);

    provider.rates = { ...provider.rates, NGN: '100000000' };
    const retry = await client.swap(wallet, swap, 'retry-1').expect(201);

    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.text).toBe(first.text);

    // A genuinely new request at the new rate is still refused.
    const fresh = await client.swap(wallet, swap, 'retry-2').expect(422);
    expect((fresh.body as ErrorBody).error.code).toBe('AMOUNT_TOO_SMALL');
  });

  it('does not call the FX provider to replay a swap or a transfer', async () => {
    const { provider, client } = uncachedApp();
    const ada = await client.fundedWallet('ada@example.com', 'USDx', '50');
    const kofi = await client.createWallet('kofi@example.com');
    const transfer = {
      fromWalletId: ada,
      toWalletId: kofi,
      sourceCurrency: 'USDx',
      destinationCurrency: 'EURx',
      amount: '5',
    };
    const usdSwap = { fromCurrency: 'USDx', toCurrency: 'EURx', amount: '5' };
    await client.swap(ada, usdSwap, 'swap-key').expect(201);
    await client.transfer(transfer, 'transfer-key').expect(201);

    const callsBefore = provider.calls;
    provider.failing = true;
    const swapRetry = await client.swap(ada, usdSwap, 'swap-key').expect(201);
    const transferRetry = await client.transfer(transfer, 'transfer-key').expect(201);

    expect(provider.calls).toBe(callsBefore);
    expect(swapRetry.headers['idempotent-replayed']).toBe('true');
    expect(transferRetry.headers['idempotent-replayed']).toBe('true');
  });

  it('rejects a reused key before asking for a rate', async () => {
    const { provider, client } = uncachedApp();
    const wallet = await client.fundedWallet('reuse@example.com', 'USDx', '50');
    const body = { fromCurrency: 'USDx', toCurrency: 'EURx', amount: '5' };
    await client.swap(wallet, body, 'reused').expect(201);

    const callsBefore = provider.calls;
    const res = await client.swap(wallet, { ...body, amount: '6' }, 'reused').expect(422);
    expect((res.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(provider.calls).toBe(callsBefore);
  });
});

describe('same-currency transfers', () => {
  it('never call the FX provider, because no conversion happens', async () => {
    const { provider, client } = uncachedApp();
    const ada = await client.fundedWallet('ada@example.com', 'USDx', '50');
    const kofi = await client.createWallet('kofi@example.com');

    const callsBefore = provider.calls;
    await client
      .transfer({ fromWalletId: ada, toWalletId: kofi, sourceCurrency: 'USDx', amount: '5' })
      .expect(201);
    expect(provider.calls).toBe(callsBefore);
  });
});
