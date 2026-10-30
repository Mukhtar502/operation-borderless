import type { RequestHandler } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireIdempotencyKey, sendIdempotent } from '../idempotency/idempotency.http.js';
import type { TransferService } from './transfer.service.js';
import { transferBody } from './transfer.validation.js';

export function transferController(transfers: TransferService) {
  const create: RequestHandler = async (req, res) => {
    const body = validate(transferBody, req.body);
    const idempotencyKey = requireIdempotencyKey(req);
    sendIdempotent(
      res,
      await transfers.transfer({
        ...body,
        idempotencyKey,
        destinationCurrency: body.destinationCurrency ?? body.sourceCurrency,
      }),
    );
  };

  return { create };
}
