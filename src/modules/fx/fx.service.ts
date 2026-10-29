import { Decimal } from 'decimal.js';
import { CURRENCIES, CURRENCY_CODES, type CurrencyCode } from '../../domain/currencies.js';
import { Money } from '../../domain/money.js';
import type { Logger } from '../../lib/logger.js';
import type { FxProvider } from './fx.provider.js';
import { STATIC_RATES_AS_OF, STATIC_USD_RATES } from './static-rates.js';

/**
 * live:   fetched from the provider within the cache TTL
 * stale:  provider is failing; last good live rates are reused
 * static: provider has not answered since start-up; built-in table is used
 */
export type RateSource = 'live' | 'stale' | 'static';

export interface RateSnapshot {
  source: RateSource;
  provider: string;
  /** Units of each stablecoin per 1 USDx. */
  usdRates: Record<CurrencyCode, Money>;
  /** When these rates were last successfully refreshed. */
  refreshedAt: Date;
}

export interface FxQuote {
  from: CurrencyCode;
  to: CurrencyCode;
  /** Units of `to` per 1 unit of `from`. */
  rate: Money;
  source: RateSource;
  provider: string;
  refreshedAt: Date;
}

export interface FxServiceOptions {
  cacheTtlMs: number;
  /** After a failed refresh, wait this long before calling the provider again. */
  retryBackoffMs?: number;
  now?: () => number;
}

/** Rates are kept to 18 decimal places, matching the transactions.fx_rate column. */
export const RATE_DECIMALS = 18;

export class FxService {
  private live: { snapshot: RateSnapshot; fetchedAtMs: number } | undefined;
  private inflight: Promise<RateSnapshot | undefined> | undefined;
  private nextAttemptAtMs = 0;
  private readonly cacheTtlMs: number;
  private readonly retryBackoffMs: number;
  private readonly now: () => number;

  constructor(
    private readonly provider: FxProvider,
    private readonly logger: Logger,
    options: FxServiceOptions,
  ) {
    this.cacheTtlMs = options.cacheTtlMs;
    this.retryBackoffMs = options.retryBackoffMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  /** Never throws: a provider failure falls back to stale, then static, rates. */
  async getSnapshot(): Promise<RateSnapshot> {
    if (this.live && this.now() - this.live.fetchedAtMs < this.cacheTtlMs) {
      return this.live.snapshot;
    }
    if (this.now() >= this.nextAttemptAtMs) {
      const fresh = await this.refresh();
      if (fresh) return fresh;
    }
    if (this.live) return { ...this.live.snapshot, source: 'stale' };
    return staticSnapshot();
  }

  async quote(from: CurrencyCode, to: CurrencyCode): Promise<FxQuote> {
    return quoteFrom(await this.getSnapshot(), from, to);
  }

  // Concurrent callers share one in-flight request instead of each hitting the provider.
  private refresh(): Promise<RateSnapshot | undefined> {
    this.inflight ??= this.fetchLive().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async fetchLive(): Promise<RateSnapshot | undefined> {
    try {
      const { rates } = await this.provider.fetchUsdRates();
      const snapshot: RateSnapshot = {
        source: 'live',
        provider: this.provider.name,
        usdRates: toCurrencyRates(rates),
        refreshedAt: new Date(this.now()),
      };
      this.live = { snapshot, fetchedAtMs: this.now() };
      return snapshot;
    } catch (err) {
      this.nextAttemptAtMs = this.now() + this.retryBackoffMs;
      this.logger.warn(
        { err, provider: this.provider.name, fallback: this.live ? 'stale' : 'static' },
        'FX provider failed; using fallback rates',
      );
      return undefined;
    }
  }
}

export function quoteFrom(snapshot: RateSnapshot, from: CurrencyCode, to: CurrencyCode): FxQuote {
  const rate =
    from === to
      ? new Money(1)
      : snapshot.usdRates[to]
          .div(snapshot.usdRates[from])
          .toDecimalPlaces(RATE_DECIMALS, Decimal.ROUND_DOWN);
  return {
    from,
    to,
    rate,
    source: snapshot.source,
    provider: snapshot.provider,
    refreshedAt: snapshot.refreshedAt,
  };
}

function staticSnapshot(): RateSnapshot {
  return {
    source: 'static',
    provider: 'static-table',
    usdRates: toCurrencyRates(STATIC_USD_RATES),
    refreshedAt: STATIC_RATES_AS_OF,
  };
}

/** Maps fiat rates to stablecoins. Rejects the whole snapshot if any currency is missing. */
function toCurrencyRates(rates: Record<string, string>): Record<CurrencyCode, Money> {
  const result = {} as Record<CurrencyCode, Money>;
  for (const code of CURRENCY_CODES) {
    const { fiatCode } = CURRENCIES[code];
    const value = rates[fiatCode];
    if (value === undefined) throw new Error(`FX rates are missing ${fiatCode}`);
    const rate = new Money(value);
    if (!rate.isFinite() || rate.lte(0)) throw new Error(`FX rate for ${fiatCode} is invalid`);
    result[code] = rate;
  }
  return result;
}
