import { z } from 'zod';

export const createWalletBody = z
  .strictObject({
    email: z.string().trim().pipe(z.email()).optional(),
    phone: z.string().min(1).optional(),
  })
  .refine((body) => body.email !== undefined || body.phone !== undefined, {
    message: 'Provide an email or a phone number',
  });
