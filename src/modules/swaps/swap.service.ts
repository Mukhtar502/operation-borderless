import { convertOrReject } from '../../domain/conversion.js';
import type { CurrencyCode } from '../../domain/currencies.js';
import { formatAmount, parseAmount } from '../../domain/money.js';
import { badRequest } from '../../lib/errors.js';
import type { IdempotencyService } from '../idempotency/idempotency.service.js';
import type { LedgerService } from '../ledger/ledger.service.js';
import { movePostings } from '../ledger/postings.js';
import type { FxService } from '../rates/fx.service.js';
import {
  created,
  rateSourceOf,
  type CreatedTransaction,
} from '../transactions/transaction.mapper.js';

export interface SwapInput {
  walletId: string;
  idempotencyKey: string;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  /** Amount of fromCurrency to sell. */
  amount: string;
}

export class SwapService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
    private readonly fx: FxService,
  ) {}

  /**
   * Converts one stablecoin into another inside the same wallet. The FX pool takes the
   * other side of the trade, and the received amount is rounded down.
   */
  async swap(input: SwapInput): Promise<CreatedTransaction> {
    const { walletId, fromCurrency, toCurrency, idempotencyKey } = input;
    if (fromCurrency === toCurrency) {
      throw badRequest('SAME_CURRENCY', 'fromCurrency and toCurrency must be different');
    }
    const sent = parseAmount(input.amount, fromCurrency);
    const sourceAmount = formatAmount(sent, fromCurrency);

    // The fingerprint leaves the rate out, so a retry after the rate moves is still the
    // same request. It replays its first result before any rate is even looked up.
    const request = {
      scope: `wallet:${walletId}`,
      key: idempotencyKey,
      fingerprint: { op: 'SWAP', walletId, fromCurrency, toCurrency, amount: sourceAmount },
    };
    const earlier = await this.idempotency.findReplay<CreatedTransaction['body']>(request);
    if (earlier) return earlier;

    // The rate is fixed before the database transaction starts, so no locks are held
    // during a network call, and it is recorded with the transaction.
    const quote = await this.fx.quote(fromCurrency, toCurrency);
    const received = convertOrReject(sent, quote.rate, fromCurrency, toCurrency);

    return this.idempotency.run(request, async (trx) => {
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
          idempotency_key: idempotencyKey,
        },
        postings: movePostings({
          fromWalletId: walletId,
          toWalletId: walletId,
          from: fromCurrency,
          to: toCurrency,
          sent,
          received,
        }),
      });
      return created(transaction);
    });
  }
}
