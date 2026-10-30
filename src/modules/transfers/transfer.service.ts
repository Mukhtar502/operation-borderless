import type { Trx } from '../../db/client.js';
import { convertOrReject } from '../../domain/conversion.js';
import type { CurrencyCode } from '../../domain/currencies.js';
import { formatAmount, parseAmount } from '../../domain/money.js';
import { badRequest, notFound } from '../../lib/errors.js';
import type { IdempotencyService } from '../idempotency/idempotency.service.js';
import type { LedgerService } from '../ledger/ledger.service.js';
import { movePostings } from '../ledger/postings.js';
import type { FxService } from '../rates/fx.service.js';
import {
  created,
  rateSourceOf,
  type CreatedTransaction,
} from '../transactions/transaction.mapper.js';

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

export class TransferService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
    private readonly fx: FxService,
  ) {}

  /**
   * Sends money to another wallet. When the currencies differ it converts at the current
   * rate, exactly like a swap, but the converted amount lands in the receiver's wallet.
   */
  async transfer(input: TransferInput): Promise<CreatedTransaction> {
    const { fromWalletId, toWalletId, sourceCurrency, destinationCurrency, idempotencyKey } = input;
    if (fromWalletId === toWalletId) {
      throw badRequest(
        'SAME_WALLET',
        'fromWalletId and toWalletId must be different; use a swap to convert within a wallet',
      );
    }
    const sent = parseAmount(input.amount, sourceCurrency);
    const sourceAmount = formatAmount(sent, sourceCurrency);

    // Fixed before the database transaction, as for swaps (see SwapService).
    const quote = await this.fx.quote(sourceCurrency, destinationCurrency);
    const received = convertOrReject(sent, quote.rate, sourceCurrency, destinationCurrency);

    return this.idempotency.run(
      {
        scope: `wallet:${fromWalletId}`,
        key: idempotencyKey,
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
            idempotency_key: idempotencyKey,
          },
          postings: movePostings({
            fromWalletId,
            toWalletId,
            from: sourceCurrency,
            to: destinationCurrency,
            sent,
            received,
          }),
        });
        return created(transaction);
      },
    );
  }
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
