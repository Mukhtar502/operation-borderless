import type { RequestHandler } from 'express';
import { validate } from '../../middleware/validate.js';
import { walletIdParams } from '../common.validation.js';
import { requireIdempotencyKey, sendIdempotent } from '../idempotency/idempotency.http.js';
import type { SwapService } from './swap.service.js';
import { swapBody } from './swap.validation.js';

export function swapController(swaps: SwapService) {
  const create: RequestHandler = async (req, res) => {
    const { walletId } = validate(walletIdParams, req.params, 'params');
    const body = validate(swapBody, req.body);
    const idempotencyKey = requireIdempotencyKey(req);
    sendIdempotent(res, await swaps.swap({ walletId, idempotencyKey, ...body }));
  };

  return { create };
}
