import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/lib/logger.js';
import { OpenErApiProvider, type FxProvider } from '../../src/modules/rates/fx.provider.js';
import { FxService } from '../../src/modules/rates/fx.service.js';
import { STATIC_RATES_AS_OF } from '../../src/modules/rates/static-rates.js';

const logger = createLogger('silent');
const LIVE = { USD: 1, EUR: 0.9, NGN: 1500, GHS: 15, XAF: 590, JPY: 150 };

function providerResponse(rates: Record<string, number> = LIVE, status = 200): Response {
  return new Response(
    JSON.stringify({
      result: 'success',
      base_code: 'USD',
      time_last_update_unix: 1_790_000_000,
      rates,
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

function setup(fetchFn: typeof fetch, ttlMs = 60_000) {
  let now = 1_000_000;
  const provider = new OpenErApiProvider('https://fx.test/latest/USD', 50, fetchFn);
  const fx = new FxService(provider, logger, {
    cacheTtlMs: ttlMs,
    retryBackoffMs: 10_000,
    now: () => now,
  });
  return {
    fx,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('FxService', () => {
  it('computes cross rates from live USD rates', async () => {
    const { fx } = setup(vi.fn<typeof fetch>().mockResolvedValue(providerResponse()));

    const ngnToGhs = await fx.quote('cNGN', 'cGHS');
    expect(ngnToGhs.rate.toFixed()).toBe('0.01'); // 15 / 1500
    expect(ngnToGhs.source).toBe('live');
    expect(ngnToGhs.provider).toBe('open.er-api.com');

    expect((await fx.quote('USDx', 'cNGN')).rate.toFixed()).toBe('1500');
    expect((await fx.quote('EURx', 'EURx')).rate.toFixed()).toBe('1');
  });

  it('rounds rates down to 18 decimal places', async () => {
    const { fx } = setup(vi.fn<typeof fetch>().mockResolvedValue(providerResponse()));
    // 1 / 1500 = 0.000666666...
    expect((await fx.quote('cNGN', 'USDx')).rate.toFixed()).toBe('0.000666666666666666');
  });

  it('serves cached rates within the TTL and refreshes after it', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(providerResponse()));
    const { fx, advance } = setup(fetchFn, 60_000);

    await fx.getSnapshot();
    advance(59_000);
    await fx.getSnapshot();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    advance(2_000);
    await fx.getSnapshot();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('shares one provider call between concurrent requests', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(providerResponse()));
    const { fx } = setup(fetchFn);
    await Promise.all(Array.from({ length: 20 }, () => fx.getSnapshot()));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('falls back to the static table when the provider has never answered', async () => {
    const { fx } = setup(vi.fn<typeof fetch>().mockRejectedValue(new Error('ECONNREFUSED')));
    const snapshot = await fx.getSnapshot();
    expect(snapshot.source).toBe('static');
    expect(snapshot.provider).toBe('static-table');
    expect(snapshot.refreshedAt).toEqual(STATIC_RATES_AS_OF);
  });

  it('reuses the last good rates, marked stale, when the provider starts failing', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(providerResponse())
      .mockResolvedValue(providerResponse(LIVE, 503));
    const { fx, advance } = setup(fetchFn, 60_000);

    const live = await fx.getSnapshot();
    advance(61_000);
    const stale = await fx.getSnapshot();

    expect(stale.source).toBe('stale');
    expect(stale.refreshedAt).toEqual(live.refreshedAt);
    expect(stale.usdRates.cNGN.toFixed()).toBe('1500');
  });

  it('reports when the provider published the rates, apart from when we fetched them', async () => {
    const { fx } = setup(vi.fn<typeof fetch>().mockResolvedValue(providerResponse()));
    const snapshot = await fx.getSnapshot();
    expect(snapshot.providerUpdatedAt).toEqual(new Date(1_790_000_000 * 1000));
    expect(snapshot.refreshedAt).toEqual(new Date(1_000_000));
  });

  it('stops reusing old rates after the maximum age and uses the static table', async () => {
    let now = 1_000_000;
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(providerResponse())
      .mockRejectedValue(new Error('down'));
    const provider = new OpenErApiProvider('https://fx.test/latest/USD', 50, fetchFn);
    const fx = new FxService(provider, logger, {
      cacheTtlMs: 60_000,
      retryBackoffMs: 10_000,
      maxStaleMs: 3_600_000,
      now: () => now,
    });

    await fx.getSnapshot();
    now += 3_600_000;
    expect((await fx.getSnapshot()).source).toBe('stale');
    now += 1;
    expect((await fx.getSnapshot()).source).toBe('static');
  });

  it('waits before retrying a failed provider', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new Error('down'));
    const { fx, advance } = setup(fetchFn);

    await fx.getSnapshot();
    await fx.getSnapshot();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    advance(10_000);
    await fx.getSnapshot();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('falls back when the provider is too slow', async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    const { fx } = setup(hang);
    expect((await fx.getSnapshot()).source).toBe('static');
  });

  it.each([
    ['a missing currency', providerResponse({ USD: 1, EUR: 0.9, NGN: 1500, GHS: 15 })],
    ['a zero rate', providerResponse({ ...LIVE, GHS: 0 })],
    ['a non-USD base', new Response(JSON.stringify({ result: 'success', base_code: 'EUR' }))],
    ['invalid JSON', new Response('<html>oops</html>')],
  ])('rejects a response with %s and falls back', async (_label, response) => {
    const { fx } = setup(vi.fn<typeof fetch>().mockResolvedValue(response));
    expect((await fx.getSnapshot()).source).toBe('static');
  });

  it('accepts any provider that implements the interface', async () => {
    const provider: FxProvider = {
      name: 'fixed',
      fetchUsdRates: () =>
        Promise.resolve({
          rates: { USD: '1', EUR: '0.5', NGN: '1000', GHS: '10', XAF: '500' },
          updatedAt: new Date(),
        }),
    };
    const fx = new FxService(provider, logger, { cacheTtlMs: 1000 });
    expect((await fx.quote('EURx', 'USDx')).rate.toFixed()).toBe('2');
  });
});
