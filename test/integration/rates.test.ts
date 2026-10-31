import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { FxService } from '../../src/modules/rates/fx.service.js';
import { STATIC_RATES_AS_OF } from '../../src/modules/rates/static-rates.js';
import { setupTestContext, testLogger } from '../helpers/context.js';
import { FakeFxProvider } from '../helpers/fake-fx.js';

const { app, db } = setupTestContext();

interface RatesBody {
  data: {
    source: string;
    provider: string;
    refreshedAt: string;
    providerUpdatedAt: string;
    rates: { from: string; to: string; rate: string; refreshedAt: string }[];
  };
}

describe('GET /v1/rates', () => {
  it('returns all 20 pairs between different currencies', async () => {
    const res = await request(app).get('/v1/rates').expect(200);
    const { data } = res.body as RatesBody;

    expect(data.source).toBe('live');
    expect(data.provider).toBe('fake-fx');
    expect(data.rates).toHaveLength(20);
    expect(data.rates.every((r) => r.from !== r.to)).toBe(true);
    expect(new Set(data.rates.map((r) => `${r.from}>${r.to}`)).size).toBe(20);
  });

  it('includes the rate and when it was last refreshed', async () => {
    const res = await request(app).get('/v1/rates').expect(200);
    const { data } = res.body as RatesBody;
    const find = (from: string, to: string) =>
      data.rates.find((r) => r.from === from && r.to === to);

    expect(find('USDx', 'cNGN')?.rate).toBe('1500');
    expect(find('cNGN', 'cGHS')?.rate).toBe('0.01');
    expect(find('EURx', 'USDx')?.rate).toBe('1.25');
    expect(find('USDx', 'cNGN')?.refreshedAt).toBe(data.refreshedAt);
    expect(Number.isNaN(Date.parse(data.refreshedAt))).toBe(false);
  });

  it('serves static fallback rates when the provider is down', async () => {
    const provider = new FakeFxProvider();
    provider.failing = true;
    const fx = new FxService(provider, testLogger, { cacheTtlMs: 60_000 });
    const downApp = createApp({ db, logger: testLogger, fx });

    const res = await request(downApp).get('/v1/rates').expect(200);
    const { data } = res.body as RatesBody;
    expect(data.source).toBe('static');
    expect(data.provider).toBe('static-table');
    expect(data.refreshedAt).toBe(STATIC_RATES_AS_OF.toISOString());
    expect(data.providerUpdatedAt).toBe(STATIC_RATES_AS_OF.toISOString());
    expect(data.rates).toHaveLength(20);
  });
});
