import { z } from 'zod';
import { amount, currency } from '../common.validation.js';

export const transferBody = z.strictObject({
  fromWalletId: z.uuid(),
  toWalletId: z.uuid(),
  sourceCurrency: currency,
  /** Defaults to sourceCurrency: a plain same-currency transfer. */
  destinationCurrency: currency.optional(),
  amount,
});
