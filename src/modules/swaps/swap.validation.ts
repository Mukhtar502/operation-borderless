import { z } from 'zod';
import { amount, currency } from '../common.validation.js';

export const swapBody = z.strictObject({ fromCurrency: currency, toCurrency: currency, amount });
