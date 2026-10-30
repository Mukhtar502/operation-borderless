import type { CurrencyCode } from '../../domain/currencies.js';
import { convert, formatAmount, parseAmount } from '../../domain/money.js';
import { badRequest, unprocessable } from '../../lib/errors.js';
import type { FxService } from '../fx/fx.service.js';
import type { IdempotencyService, IdempotentResponse } from '../idempotency/idempotency.service.js';
import type { LedgerService } from '../ledger/ledger.service.js';
import {
  PAR_RATE_SOURCE,
  rateSourceOf,
  toTransactionView,
  type TransactionView,
} from '../transactions/transaction.view.js';

export interface DepositInput {
  walletId: string;
  idempotencyKey: string;
  currency: CurrencyCode;
  amount: string;
}

export interface SwapInput {
  walletId: string;
  idempotencyKey: string;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  /** Amount of fromCurrency to sell. */
  amount: string;
}

export type PaymentResponse = IdempotentResponse<{ data: TransactionView }>;

/**
 * Deposits, swaps and transfers. Each method validates its input, then hands one
 * balanced set of postings to the ledger inside an idempotent transaction.
 */
export class PaymentService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
    private readonly fx: FxService,
  ) {}

  /**
   * Simulated on-ramp: money arrives from outside the platform. The EXTERNAL account
   * is debited, so its negative balance always equals the total ever deposited.
   */
  deposit(input: DepositInput): Promise<PaymentResponse> {
    const { walletId, currency } = input;
    const amount = parseAmount(input.amount, currency);
    const formatted = formatAmount(amount, currency);

    return this.idempotency.run(
      {
        scope: `wallet:${walletId}`,
        key: input.idempotencyKey,
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
            idempotency_key: input.idempotencyKey,
          },
          postings: [
            { account: { system: 'EXTERNAL', currency }, amount: amount.negated() },
            { account: { walletId, currency }, amount },
          ],
        });
        return {
          status: 201,
          body: { data: toTransactionView(transaction) },
          transactionId: transaction.id,
        };
      },
    );
  }

  /**
   * Converts one stablecoin into another inside the same wallet. The FX pool takes the
   * other side of the trade in both currencies, so each currency still balances to zero.
   * The converted amount is rounded down; the sub-unit remainder stays in the pool.
   */
  async swap(input: SwapInput): Promise<PaymentResponse> {
    const { walletId, fromCurrency, toCurrency } = input;
    if (fromCurrency === toCurrency) {
      throw badRequest('SAME_CURRENCY', 'fromCurrency and toCurrency must be different');
    }
    const amount = parseAmount(input.amount, fromCurrency);
    const sourceAmount = formatAmount(amount, fromCurrency);

    // The rate is fixed before the transaction starts and is recorded with it. The
    // fingerprint leaves the rate out, so a retry after a rate change still replays
    // the original result instead of being treated as a new request.
    const quote = await this.fx.quote(fromCurrency, toCurrency);
    const received = convert(amount, quote.rate, toCurrency);
    if (received.isZero()) {
      throw unprocessable(
        'AMOUNT_TOO_SMALL',
        `${sourceAmount} ${fromCurrency} is worth less than the smallest unit of ${toCurrency}`,
      );
    }
    const destinationAmount = formatAmount(received, toCurrency);

    return this.idempotency.run(
      {
        scope: `wallet:${walletId}`,
        key: input.idempotencyKey,
        fingerprint: { op: 'SWAP', walletId, fromCurrency, toCurrency, amount: sourceAmount },
      },
      async (trx) => {
        const { transaction } = await this.ledger.post(trx, {
          transaction: {
            type: 'SWAP',
            from_wallet_id: walletId,
            to_wallet_id: walletId,
            source_currency: fromCurrency,
            source_amount: sourceAmount,
            destination_currency: toCurrency,
            destination_amount: destinationAmount,
            fx_rate: quote.rate.toFixed(),
            fx_rate_source: rateSourceOf(quote),
            fx_rate_fetched_at: quote.refreshedAt,
            idempotency_key: input.idempotencyKey,
          },
          postings: [
            { account: { walletId, currency: fromCurrency }, amount: amount.negated() },
            { account: { system: 'FX_POOL', currency: fromCurrency }, amount },
            { account: { system: 'FX_POOL', currency: toCurrency }, amount: received.negated() },
            { account: { walletId, currency: toCurrency }, amount: received },
          ],
        });
        return {
          status: 201,
          body: { data: toTransactionView(transaction) },
          transactionId: transaction.id,
        };
      },
    );
  }
}
