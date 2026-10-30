import { Router } from 'express';
import { z } from 'zod';
import { CURRENCY_CODES } from '../../domain/currencies.js';
import { requireIdempotencyKey, sendIdempotent } from '../../http/idempotency.js';
import { allowOnly } from '../../http/methods.js';
import { validate } from '../../http/validate.js';
import { walletIdParams } from '../wallets/wallet.routes.js';
import type { PaymentService } from './payment.service.js';

const currency = z.enum(CURRENCY_CODES);
// Amounts stay strings end to end; parseAmount() checks the format and precision.
const amount = z.string();

export const depositBody = z.strictObject({ currency, amount });
export const swapBody = z.strictObject({ fromCurrency: currency, toCurrency: currency, amount });
export const transferBody = z.strictObject({
  fromWalletId: z.uuid(),
  toWalletId: z.uuid(),
  sourceCurrency: currency,
  /** Defaults to sourceCurrency: a plain same-currency transfer. */
  destinationCurrency: currency.optional(),
  amount,
});

export function paymentRoutes(payments: PaymentService): Router {
  const router = Router();

  router.post('/wallets/:walletId/deposits', async (req, res) => {
    const { walletId } = validate(walletIdParams, req.params, 'params');
    const body = validate(depositBody, req.body);
    const idempotencyKey = requireIdempotencyKey(req);
    sendIdempotent(res, await payments.deposit({ walletId, idempotencyKey, ...body }));
  });

  router.post('/wallets/:walletId/swaps', async (req, res) => {
    const { walletId } = validate(walletIdParams, req.params, 'params');
    const body = validate(swapBody, req.body);
    const idempotencyKey = requireIdempotencyKey(req);
    sendIdempotent(res, await payments.swap({ walletId, idempotencyKey, ...body }));
  });

  router.post('/transfers', async (req, res) => {
    const body = validate(transferBody, req.body);
    const idempotencyKey = requireIdempotencyKey(req);
    sendIdempotent(
      res,
      await payments.transfer({
        ...body,
        idempotencyKey,
        destinationCurrency: body.destinationCurrency ?? body.sourceCurrency,
      }),
    );
  });

  router.all('/wallets/:walletId/deposits', allowOnly('POST'));
  router.all('/wallets/:walletId/swaps', allowOnly('POST'));
  router.all('/transfers', allowOnly('POST'));

  return router;
}
