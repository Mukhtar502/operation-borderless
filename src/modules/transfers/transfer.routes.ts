import { Router } from 'express';
import { allowOnly } from '../../middleware/method-not-allowed.middleware.js';
import { transferController } from './transfer.controller.js';
import type { TransferService } from './transfer.service.js';

export function transferRoutes(transfers: TransferService): Router {
  const controller = transferController(transfers);
  const router = Router();

  router.route('/transfers').post(controller.create).all(allowOnly('POST'));

  return router;
}
