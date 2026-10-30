import { Router } from 'express';
import { allowOnly } from '../../middleware/method-not-allowed.middleware.js';
import { swapController } from './swap.controller.js';
import type { SwapService } from './swap.service.js';

export function swapRoutes(swaps: SwapService): Router {
  const controller = swapController(swaps);
  const router = Router();

  router.route('/wallets/:walletId/swaps').post(controller.create).all(allowOnly('POST'));

  return router;
}
