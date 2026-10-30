import type { RequestHandler } from 'express';
import { validate } from '../../middleware/validate.js';
import { walletIdParams } from '../common.validation.js';
import type { TransactionService } from './transaction.service.js';
import { historyQuery, transactionIdParams } from './transaction.validation.js';

export function transactionController(transactions: TransactionService) {
  const history: RequestHandler = async (req, res) => {
    const { walletId } = validate(walletIdParams, req.params, 'params');
    const query = validate(historyQuery, req.query, 'query');
    res.json(await transactions.history({ walletId, ...query }));
  };

  const get: RequestHandler = async (req, res) => {
    const { transactionId } = validate(transactionIdParams, req.params, 'params');
    res.json({ data: await transactions.get(transactionId) });
  };

  return { history, get };
}
