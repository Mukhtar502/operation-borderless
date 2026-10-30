import { z } from 'zod';

/** Units of each fiat currency per 1 USD, as decimal strings, e.g. { NGN: "1550.5" }. */
export interface ProviderRates {
  rates: Record<string, string>;
  /** When the provider says it last updated these rates. */
  updatedAt: Date;
}

export interface FxProvider {
  readonly name: string;
  fetchUsdRates(): Promise<ProviderRates>;
}

const responseSchema = z.object({
  result: z.literal('success'),
  base_code: z.literal('USD'),
  time_last_update_unix: z.number().int().positive(),
  rates: z.record(z.string(), z.number().positive()),
});

/**
 * ExchangeRate-API open endpoint (https://www.exchangerate-api.com/docs/free).
 * Free, no API key, covers NGN, GHS and XAF, which many free feeds do not.
 */
export class OpenErApiProvider implements FxProvider {
  readonly name = 'open.er-api.com';

  constructor(
    private readonly url: string,
    private readonly timeoutMs: number,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async fetchUsdRates(): Promise<ProviderRates> {
    const res = await this.fetchFn(this.url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`FX provider responded with HTTP ${res.status}`);

    const body = responseSchema.parse(await res.json());
    return {
      // The feed sends JSON numbers. String() gives the shortest exact form of each
      // value, so nothing is lost before the rate becomes a Decimal.
      rates: Object.fromEntries(Object.entries(body.rates).map(([code, v]) => [code, String(v)])),
      updatedAt: new Date(body.time_last_update_unix * 1000),
    };
  }
}
