import { z } from 'zod';
import { CURRENCY_CODES } from '../domain/currencies.js';

// Request fields shared by several modules.

export const currency = z.enum(CURRENCY_CODES);

// Amounts stay strings end to end; parseAmount() in the service checks format and precision.
export const amount = z.string();

export const walletIdParams = z.object({ walletId: z.uuid() });
