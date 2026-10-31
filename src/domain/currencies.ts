import type { CurrencyCode } from '../db/schema.js';

export type { CurrencyCode };

export interface CurrencyInfo {
  code: CurrencyCode;
  name: string;
  /** Smallest unit the platform stores, e.g. 6 means 0.000001. */
  decimals: number;
  /** Fiat currency the stablecoin tracks; used to look up FX rates. */
  fiatCode: string;
}

// Mirrors the `currencies` table seeded in the first migration. An integration
// test checks the two never drift apart.
export const CURRENCIES: Record<CurrencyCode, CurrencyInfo> = {
  cNGN: { code: 'cNGN', name: 'Nigerian Naira stablecoin', decimals: 6, fiatCode: 'NGN' },
  cGHS: { code: 'cGHS', name: 'Ghanaian Cedi stablecoin', decimals: 6, fiatCode: 'GHS' },
  cXAF: {
    code: 'cXAF',
    name: 'Central African CFA franc stablecoin',
    decimals: 6,
    fiatCode: 'XAF',
  },
  USDx: { code: 'USDx', name: 'US Dollar stablecoin', decimals: 6, fiatCode: 'USD' },
  EURx: { code: 'EURx', name: 'Euro stablecoin', decimals: 6, fiatCode: 'EUR' },
};

export const CURRENCY_CODES = Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]];
