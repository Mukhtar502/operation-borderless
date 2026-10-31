import type { FxProvider, ProviderRates } from '../../src/modules/rates/fx.provider.js';

/** Units per 1 USD. Round numbers keep expected amounts in tests easy to check by hand. */
export const TEST_USD_RATES = { USD: '1', EUR: '0.8', NGN: '1500', GHS: '15', XAF: '600' };

/** In-memory FX provider so tests never depend on the network. */
export class FakeFxProvider implements FxProvider {
  readonly name = 'fake-fx';
  failing = false;
  calls = 0;
  rates: Record<string, string> = { ...TEST_USD_RATES };

  fetchUsdRates(): Promise<ProviderRates> {
    this.calls += 1;
    if (this.failing) return Promise.reject(new Error('fake provider is down'));
    return Promise.resolve({ rates: { ...this.rates }, updatedAt: new Date() });
  }
}
