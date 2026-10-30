import { z } from 'zod';
import { amount, currency } from '../common.validation.js';

export const depositBody = z.strictObject({ currency, amount });
