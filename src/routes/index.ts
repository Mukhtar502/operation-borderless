import { Router } from 'express';
import type { Services } from '../container.js';
import { depositRoutes } from '../modules/deposits/deposit.routes.js';
import { rateRoutes } from '../modules/rates/rate.routes.js';
import { swapRoutes } from '../modules/swaps/swap.routes.js';
import { transactionRoutes } from '../modules/transactions/transaction.routes.js';
import { transferRoutes } from '../modules/transfers/transfer.routes.js';
import { walletRoutes } from '../modules/wallets/wallet.routes.js';

/** Every API endpoint, mounted under /v1 by the app. */
export function apiRoutes(services: Services): Router {
  const router = Router();

  router.use(walletRoutes(services.wallets));
  router.use(depositRoutes(services.deposits));
  router.use(swapRoutes(services.swaps));
  router.use(transferRoutes(services.transfers));
  router.use(transactionRoutes(services.transactions));
  router.use(rateRoutes(services.fx));

  return router;
}
