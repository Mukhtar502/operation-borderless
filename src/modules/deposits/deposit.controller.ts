import type { RequestHandler } from 'express';
import { validate } from '../../middleware/validate.js';
import { walletIdParams } from '../common.validation.js';
import { requireIdempotencyKey, sendIdempotent } from '../idempotency/idempotency.http.js';
import type { DepositService } from './deposit.service.js';
import { depositBody } from './deposit.validation.js';

export function depositController(deposits: DepositService) {
  const create: RequestHandler = async (req, res) => {
    const { walletId } = validate(walletIdParams, req.params, 'params');
    const body = validate(depositBody, req.body);
    const idempotencyKey = requireIdempotencyKey(req);
    sendIdempotent(res, await deposits.deposit({ walletId, idempotencyKey, ...body }));
  };

  return { create };
}
