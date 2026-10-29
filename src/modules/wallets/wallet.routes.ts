import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../http/validate.js';
import type { WalletService } from './wallet.service.js';

export const createWalletBody = z
  .strictObject({
    email: z.string().trim().pipe(z.email()).optional(),
    phone: z.string().min(1).optional(),
  })
  .refine((body) => body.email !== undefined || body.phone !== undefined, {
    message: 'Provide an email or a phone number',
  });

export const walletIdParams = z.object({ walletId: z.uuid() });

export function walletRoutes(wallets: WalletService): Router {
  const router = Router();

  router.post('/wallets', async (req, res) => {
    const body = validate(createWalletBody, req.body);
    const wallet = await wallets.create(body);
    res.status(201).location(`/v1/wallets/${wallet.id}`).json({ data: wallet });
  });

  router.get('/wallets/:walletId', async (req, res) => {
    const { walletId } = validate(walletIdParams, req.params);
    res.json({ data: await wallets.get(walletId) });
  });

  return router;
}
