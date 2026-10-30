import { Router } from 'express';
import { z } from 'zod';
import { CURRENCY_CODES } from '../../domain/currencies.js';
import { validate } from '../../http/validate.js';
import { walletIdParams } from '../wallets/wallet.routes.js';
import type { TransactionService } from './transaction.service.js';

export const historyQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  type: z.enum(['DEPOSIT', 'SWAP', 'TRANSFER']).optional(),
  currency: z.enum(CURRENCY_CODES).optional(),
});

export const transactionIdParams = z.object({ transactionId: z.uuid() });

export function transactionRoutes(transactions: TransactionService): Router {
  const router = Router();

  router.get('/wallets/:walletId/transactions', async (req, res) => {
    const { walletId } = validate(walletIdParams, req.params);
    const query = validate(historyQuery, req.query);
    res.json(await transactions.history({ walletId, ...query }));
  });

  router.get('/transactions/:transactionId', async (req, res) => {
    const { transactionId } = validate(transactionIdParams, req.params);
    res.json({ data: await transactions.get(transactionId) });
  });

  return router;
}
