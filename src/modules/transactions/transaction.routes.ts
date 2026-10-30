import { Router } from 'express';
import { allowOnly } from '../../middleware/method-not-allowed.middleware.js';
import { transactionController } from './transaction.controller.js';
import type { TransactionService } from './transaction.service.js';

export function transactionRoutes(transactions: TransactionService): Router {
  const controller = transactionController(transactions);
  const router = Router();

  router.route('/wallets/:walletId/transactions').get(controller.history).all(allowOnly('GET'));
  router.route('/transactions/:transactionId').get(controller.get).all(allowOnly('GET'));

  return router;
}
