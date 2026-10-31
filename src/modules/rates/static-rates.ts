// Last-resort rates, used only when there are no usable live rates: the provider has not
// answered since start-up, or its last answer is too old. Units per 1 USD, taken from the
// live feed on the date below. They are clearly labelled "static" wherever they are used.
export const STATIC_RATES_AS_OF = new Date('2026-10-29T00:02:31Z');

export const STATIC_USD_RATES: Record<string, string> = {
  USD: '1',
  EUR: '0.897215',
  NGN: '1346.236888',
  GHS: '11.639916',
  XAF: '588.52908',
};
