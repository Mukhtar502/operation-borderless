import type { Transaction, TransactionType } from '../../db/schema.js';
import type { CurrencyCode } from '../../domain/currencies.js';
import type { HandlerResult, IdempotentResponse } from '../idempotency/idempotency.service.js';
import type { FxQuote } from '../rates/fx.service.js';

// Maps database rows to the shape the API returns. Every endpoint that returns a
// transaction (deposits, swaps, transfers, history, lookup) goes through here.

/** Stored in transactions.fx_rate_source when no conversion happened. */
export const PAR_RATE_SOURCE = 'par';

export interface TransactionView {
  id: string;
  type: TransactionType;
  /** Sender wallet; null for deposits, which come from outside the platform. */
  fromWalletId: string | null;
  toWalletId: string;
  source: { currency: CurrencyCode; amount: string };
  destination: { currency: CurrencyCode; amount: string };
  fx: {
    rate: string;
    /** live | stale | static from the FX service, or "par" when no conversion happened. */
    source: string;
    provider: string | null;
    refreshedAt: Date;
  };
  createdAt: Date;
}

/** What deposit, swap and transfer services return: a 201 with the new transaction. */
export type CreatedTransaction = IdempotentResponse<{ data: TransactionView }>;

export function created(row: Transaction): HandlerResult<{ data: TransactionView }> {
  return { status: 201, body: { data: toTransactionView(row) }, transactionId: row.id };
}

/** "live:open.er-api.com" style value for transactions.fx_rate_source. */
export function rateSourceOf(quote: FxQuote): string {
  return quote.from === quote.to ? PAR_RATE_SOURCE : `${quote.source}:${quote.provider}`;
}

export function toTransactionView(row: Transaction): TransactionView {
  const [source = PAR_RATE_SOURCE, ...provider] = row.fx_rate_source.split(':');
  return {
    id: row.id,
    type: row.type,
    fromWalletId: row.from_wallet_id,
    toWalletId: row.to_wallet_id,
    source: { currency: row.source_currency, amount: row.source_amount },
    destination: { currency: row.destination_currency, amount: row.destination_amount },
    fx: {
      rate: trimZeros(row.fx_rate),
      source,
      provider: provider.length ? provider.join(':') : null,
      refreshedAt: row.fx_rate_fetched_at,
    },
    createdAt: row.created_at,
  };
}

// fx_rate is NUMERIC(38,18), so "1500" comes back as "1500.000000000000000000".
function trimZeros(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}
