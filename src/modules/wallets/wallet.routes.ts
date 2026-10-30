import { Router } from 'express';
import { allowOnly } from '../../middleware/method-not-allowed.middleware.js';
import { walletController } from './wallet.controller.js';
import type { WalletService } from './wallet.service.js';

export function walletRoutes(wallets: WalletService): Router {
  const controller = walletController(wallets);
  const router = Router();

  router.route('/wallets').post(controller.create).all(allowOnly('POST'));
  router.route('/wallets/:walletId').get(controller.get).all(allowOnly('GET'));
  router.route('/wallets/:walletId/balances').get(controller.balances).all(allowOnly('GET'));

  return router;
}
