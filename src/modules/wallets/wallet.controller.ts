import type { RequestHandler } from 'express';
import { validate } from '../../middleware/validate.js';
import { walletIdParams } from '../common.validation.js';
import type { WalletService } from './wallet.service.js';
import { createWalletBody } from './wallet.validation.js';

export function walletController(wallets: WalletService) {
  const create: RequestHandler = async (req, res) => {
    const body = validate(createWalletBody, req.body);
    const wallet = await wallets.create(body);
    res.status(201).location(`/v1/wallets/${wallet.id}`).json({ data: wallet });
  };

  const get: RequestHandler = async (req, res) => {
    const { walletId } = validate(walletIdParams, req.params, 'params');
    res.json({ data: await wallets.get(walletId) });
  };

  const balances: RequestHandler = async (req, res) => {
    const { walletId } = validate(walletIdParams, req.params, 'params');
    res.json({ data: await wallets.getBalances(walletId) });
  };

  return { create, get, balances };
}
