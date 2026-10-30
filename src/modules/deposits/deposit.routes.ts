import { Router } from 'express';
import { allowOnly } from '../../middleware/method-not-allowed.middleware.js';
import { depositController } from './deposit.controller.js';
import type { DepositService } from './deposit.service.js';

export function depositRoutes(deposits: DepositService): Router {
  const controller = depositController(deposits);
  const router = Router();

  router.route('/wallets/:walletId/deposits').post(controller.create).all(allowOnly('POST'));

  return router;
}
