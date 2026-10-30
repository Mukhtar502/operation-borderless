import { Router } from 'express';
import { allowOnly } from '../../middleware/method-not-allowed.middleware.js';
import type { FxService } from './fx.service.js';
import { rateController } from './rate.controller.js';

export function rateRoutes(fx: FxService): Router {
  const controller = rateController(fx);
  const router = Router();

  router.route('/rates').get(controller.list).all(allowOnly('GET'));

  return router;
}
