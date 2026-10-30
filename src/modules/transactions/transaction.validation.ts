import { z } from 'zod';
import { currency } from '../common.validation.js';

export const historyQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  type: z.enum(['DEPOSIT', 'SWAP', 'TRANSFER']).optional(),
  currency: currency.optional(),
});

export const transactionIdParams = z.object({ transactionId: z.uuid() });
