// Last-resort rates, used only when the live provider has never answered since the
// process started. Indicative values, units per 1 USD. XAF is derived from its fixed
// peg to the euro (655.957 XAF = 1 EUR) so EURx <-> cXAF stays consistent.
export const STATIC_RATES_AS_OF = new Date('2026-10-01T00:00:00Z');

export const STATIC_USD_RATES: Record<string, string> = {
  USD: '1',
  EUR: '0.92',
  NGN: '1550',
  GHS: '15.5',
  XAF: '603.48044',
};
