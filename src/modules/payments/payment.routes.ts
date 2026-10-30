import { Router } from 'express';
import { z } from 'zod';
import { CURRENCY_CODES } from '../../domain/currencies.js';
import { requireIdempotencyKey, sendIdempotent } from '../../http/idempotency.js';
import { validate } from '../../http/validate.js';
import { walletIdParams } from '../wallets/wallet.routes.js';
import type { PaymentService } from './payment.service.js';

const currency = z.enum(CURRENCY_CODES);
// Amounts stay strings end to end; parseAmount() checks the format and precision.
const amount = z.string({ error: 'amount must be a string, e.g. "100.50"' });

export const depositBody = z.strictObject({ currency, amount });
export const swapBody = z.strictObject({ fromCurrency: currency, toCurrency: currency, amount });

export function paymentRoutes(payments: PaymentService): Router {
  const router = Router();

  router.post('/wallets/:walletId/deposits', async (req, res) => {
    const { walletId } = validate(walletIdParams, req.params);
    const body = validate(depositBody, req.body);
    const idempotencyKey = requireIdempotencyKey(req);
    sendIdempotent(res, await payments.deposit({ walletId, idempotencyKey, ...body }));
  });

  router.post('/wallets/:walletId/swaps', async (req, res) => {
    const { walletId } = validate(walletIdParams, req.params);
    const body = validate(swapBody, req.body);
    const idempotencyKey = requireIdempotencyKey(req);
    sendIdempotent(res, await payments.swap({ walletId, idempotencyKey, ...body }));
  });

  return router;
}
