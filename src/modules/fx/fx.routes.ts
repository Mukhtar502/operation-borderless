import { Router } from 'express';
import { CURRENCY_CODES } from '../../domain/currencies.js';
import { allowOnly } from '../../http/methods.js';
import { quoteFrom, type FxService } from './fx.service.js';

export function fxRoutes(fx: FxService): Router {
  const router = Router();

  // Every directed pair between different currencies: 5 x 4 = 20 rates.
  router.get('/rates', async (_req, res) => {
    const snapshot = await fx.getSnapshot();
    const rates = CURRENCY_CODES.flatMap((from) =>
      CURRENCY_CODES.filter((to) => to !== from).map((to) => {
        const quote = quoteFrom(snapshot, from, to);
        return { from, to, rate: quote.rate.toFixed(), refreshedAt: quote.refreshedAt };
      }),
    );
    res.json({
      data: {
        source: snapshot.source,
        provider: snapshot.provider,
        refreshedAt: snapshot.refreshedAt,
        rates,
      },
    });
  });

  router.all('/rates', allowOnly('GET'));

  return router;
}
