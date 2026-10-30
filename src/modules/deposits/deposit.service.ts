import type { CurrencyCode } from '../../domain/currencies.js';
import { formatAmount, parseAmount } from '../../domain/money.js';
import type { IdempotencyService } from '../idempotency/idempotency.service.js';
import type { LedgerService } from '../ledger/ledger.service.js';
import {
  created,
  PAR_RATE_SOURCE,
  type CreatedTransaction,
} from '../transactions/transaction.mapper.js';

export interface DepositInput {
  walletId: string;
  idempotencyKey: string;
  currency: CurrencyCode;
  amount: string;
}

export class DepositService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * Simulated on-ramp: money arrives from outside the platform. The EXTERNAL account
   * is debited, so its negative balance always equals the total ever deposited.
   */
  deposit(input: DepositInput): Promise<CreatedTransaction> {
    const { walletId, currency, idempotencyKey } = input;
    const amount = parseAmount(input.amount, currency);
    const formatted = formatAmount(amount, currency);

    return this.idempotency.run(
      {
        scope: `wallet:${walletId}`,
        key: idempotencyKey,
        fingerprint: { op: 'DEPOSIT', walletId, currency, amount: formatted },
      },
      async (trx) => {
        const { transaction } = await this.ledger.post(trx, {
          transaction: {
            type: 'DEPOSIT',
            from_wallet_id: null,
            to_wallet_id: walletId,
            source_currency: currency,
            source_amount: formatted,
            destination_currency: currency,
            destination_amount: formatted,
            fx_rate: '1',
            fx_rate_source: PAR_RATE_SOURCE,
            fx_rate_fetched_at: new Date(),
            idempotency_key: idempotencyKey,
          },
          postings: [
            { account: { system: 'EXTERNAL', currency }, amount: amount.negated() },
            { account: { walletId, currency }, amount },
          ],
        });
        return created(transaction);
      },
    );
  }
}
