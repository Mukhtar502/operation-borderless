import type { RequestHandler } from 'express';
import { CURRENCY_CODES } from '../../domain/currencies.js';
import { quoteFrom, type FxService } from './fx.service.js';

export function rateController(fx: FxService) {
  // Every directed pair between different currencies: 5 x 4 = 20 rates.
  const list: RequestHandler = async (_req, res) => {
    const snapshot = await fx.getSnapshot();
    const rates = CURRENCY_CODES.flatMap((from) =>
      CURRENCY_CODES.filter((to) => to !== from).map((to) => {
        const quote = quoteFrom(snapshot, from, to);
        return {
          from,
          to,
          rate: quote.rate.toFixed(),
          refreshedAt: snapshot.refreshedAt,
          providerUpdatedAt: snapshot.providerUpdatedAt,
        };
      }),
    );
    res.json({
      data: {
        source: snapshot.source,
        provider: snapshot.provider,
        refreshedAt: snapshot.refreshedAt,
        providerUpdatedAt: snapshot.providerUpdatedAt,
        rates,
      },
    });
  };

  return { list };
}
