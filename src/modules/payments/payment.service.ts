import type { Trx } from '../../db/client.js';
import type { CurrencyCode } from '../../domain/currencies.js';
import { convert, formatAmount, parseAmount, type Money } from '../../domain/money.js';
import { badRequest, notFound, unprocessable } from '../../lib/errors.js';
import type { FxQuote, FxService } from '../fx/fx.service.js';
import type { Posting } from '../ledger/ledger.service.js';
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

export interface TransferInput {
  idempotencyKey: string;
  fromWalletId: string;
  toWalletId: string;
  /** Currency taken from the sender. */
  sourceCurrency: CurrencyCode;
  /** Currency the receiver gets. Same as sourceCurrency when no conversion is wanted. */
  destinationCurrency: CurrencyCode;
  /** Amount of sourceCurrency to send. */
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
    const { quote, received } = await this.priceConversion(amount, fromCurrency, toCurrency);

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
            destination_amount: formatAmount(received, toCurrency),
            fx_rate: quote.rate.toFixed(),
            fx_rate_source: rateSourceOf(quote),
            fx_rate_fetched_at: quote.refreshedAt,
            idempotency_key: input.idempotencyKey,
          },
          postings: movePostings(walletId, walletId, quote, amount, received),
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
   * Sends money to another wallet. When the currencies differ it converts at the current
   * rate, exactly like a swap, but the converted amount lands in the receiver's wallet.
   */
  async transfer(input: TransferInput): Promise<PaymentResponse> {
    const { fromWalletId, toWalletId, sourceCurrency, destinationCurrency } = input;
    if (fromWalletId === toWalletId) {
      throw badRequest(
        'SAME_WALLET',
        'fromWalletId and toWalletId must be different; use a swap to convert within a wallet',
      );
    }
    const amount = parseAmount(input.amount, sourceCurrency);
    const sourceAmount = formatAmount(amount, sourceCurrency);
    const { quote, received } = await this.priceConversion(
      amount,
      sourceCurrency,
      destinationCurrency,
    );

    return this.idempotency.run(
      {
        scope: `wallet:${fromWalletId}`,
        key: input.idempotencyKey,
        fingerprint: {
          op: 'TRANSFER',
          fromWalletId,
          toWalletId,
          sourceCurrency,
          destinationCurrency,
          amount: sourceAmount,
        },
      },
      async (trx) => {
        await assertWalletsExist(trx, fromWalletId, toWalletId);
        const { transaction } = await this.ledger.post(trx, {
          transaction: {
            type: 'TRANSFER',
            from_wallet_id: fromWalletId,
            to_wallet_id: toWalletId,
            source_currency: sourceCurrency,
            source_amount: sourceAmount,
            destination_currency: destinationCurrency,
            destination_amount: formatAmount(received, destinationCurrency),
            fx_rate: quote.rate.toFixed(),
            fx_rate_source: rateSourceOf(quote),
            fx_rate_fetched_at: quote.refreshedAt,
            idempotency_key: input.idempotencyKey,
          },
          postings: movePostings(fromWalletId, toWalletId, quote, amount, received),
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
   * Fixes the rate before the database transaction starts; it is recorded with the
   * transaction. Idempotency fingerprints leave the rate out, so a retry after the rate
   * moves still replays the original result instead of becoming a new request.
   */
  private async priceConversion(amount: Money, from: CurrencyCode, to: CurrencyCode) {
    const quote = await this.fx.quote(from, to);
    const received = convert(amount, quote.rate, to);
    if (received.isZero()) {
      throw unprocessable(
        'AMOUNT_TOO_SMALL',
        `${formatAmount(amount, from)} ${from} is worth less than the smallest unit of ${to}`,
      );
    }
    return { quote, received };
  }
}

/**
 * Postings that move `sent` out of one wallet and `received` into another (or the same)
 * wallet. With a conversion, the FX pool takes the other side in both currencies, so
 * each currency still balances to zero; any rounding remainder stays in the pool.
 */
function movePostings(
  fromWalletId: string,
  toWalletId: string,
  quote: FxQuote,
  sent: Money,
  received: Money,
): Posting[] {
  const { from, to } = quote;
  const debit: Posting = {
    account: { walletId: fromWalletId, currency: from },
    amount: sent.negated(),
  };
  const credit: Posting = { account: { walletId: toWalletId, currency: to }, amount: received };
  if (from === to) return [debit, credit];
  return [
    debit,
    { account: { system: 'FX_POOL', currency: from }, amount: sent },
    { account: { system: 'FX_POOL', currency: to }, amount: received.negated() },
    credit,
  ];
}

/** Says which side is missing, which a generic ledger error could not. */
async function assertWalletsExist(trx: Trx, fromWalletId: string, toWalletId: string) {
  const found = await trx
    .selectFrom('wallets')
    .select('id')
    .where('id', 'in', [fromWalletId, toWalletId])
    .execute();
  const ids = new Set(found.map((w) => w.id));
  if (!ids.has(fromWalletId)) throw notFound('WALLET_NOT_FOUND', 'Sender wallet not found');
  if (!ids.has(toWalletId)) throw notFound('WALLET_NOT_FOUND', 'Receiver wallet not found');
}
