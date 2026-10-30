import { sql } from 'kysely';
import type { DB } from '../../db/client.js';
import type { Transaction, TransactionType } from '../../db/schema.js';
import type { CurrencyCode } from '../../domain/currencies.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { toTransactionView, type TransactionView } from './transaction.view.js';

/** IN: money arrived. OUT: money left. INTERNAL: a swap inside the wallet. */
export type Direction = 'IN' | 'OUT' | 'INTERNAL';

export interface HistoryQuery {
  walletId: string;
  limit: number;
  cursor?: string | undefined;
  type?: TransactionType | undefined;
  currency?: CurrencyCode | undefined;
}

export interface HistoryPage {
  data: (TransactionView & { direction: Direction })[];
  pagination: { limit: number; hasMore: boolean; nextCursor: string | null };
}

export class TransactionService {
  constructor(private readonly db: DB) {}

  async get(transactionId: string): Promise<TransactionView> {
    const row = await this.db
      .selectFrom('transactions')
      .selectAll()
      .where('id', '=', transactionId)
      .executeTakeFirst();
    if (!row) throw notFound('TRANSACTION_NOT_FOUND', 'Transaction not found');
    return toTransactionView(row);
  }

  /**
   * A wallet's transactions, newest first, using keyset pagination: each page asks for
   * rows older than the last one already seen. Unlike page numbers, new transactions
   * arriving between requests never shift rows, so nothing is shown twice or skipped.
   */
  async history({ walletId, limit, cursor, type, currency }: HistoryQuery): Promise<HistoryPage> {
    const wallet = await this.db
      .selectFrom('wallets')
      .select('id')
      .where('id', '=', walletId)
      .executeTakeFirst();
    if (!wallet) throw notFound('WALLET_NOT_FOUND', 'Wallet not found');

    let query = this.db
      .selectFrom('transactions')
      .selectAll()
      .where((eb) =>
        eb.or([eb('from_wallet_id', '=', walletId), eb('to_wallet_id', '=', walletId)]),
      );

    if (type) query = query.where('type', '=', type);
    if (currency) {
      query = query.where((eb) =>
        eb.or([eb('source_currency', '=', currency), eb('destination_currency', '=', currency)]),
      );
    }
    if (cursor !== undefined) {
      const after = await this.resolveCursor(cursor);
      // Row comparison in SQL keeps full microsecond precision, which a JS Date would lose.
      query = query.where(
        sql<boolean>`(created_at, id) < (SELECT created_at, id FROM transactions WHERE id = ${after})`,
      );
    }

    // Fetch one extra row to learn whether another page exists.
    const rows = await query
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1)
      .execute();
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const last = page.at(-1);

    return {
      data: page.map((row) => {
        // Put direction right after type, where a reader looks for it.
        const { id, type, ...rest } = toTransactionView(row);
        return { id, type, direction: directionOf(row, walletId), ...rest };
      }),
      pagination: {
        limit,
        hasMore,
        nextCursor: hasMore && last ? encodeCursor(last.id) : null,
      },
    };
  }

  private async resolveCursor(cursor: string): Promise<string> {
    const id = decodeCursor(cursor);
    const exists =
      id &&
      (await this.db
        .selectFrom('transactions')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst());
    if (!id || !exists)
      throw badRequest(
        'INVALID_CURSOR',
        'cursor is not valid; use pagination.nextCursor from a previous response',
      );
    return id;
  }
}

function directionOf(row: Transaction, walletId: string): Direction {
  if (row.type === 'SWAP') return 'INTERNAL';
  return row.from_wallet_id === walletId ? 'OUT' : 'IN';
}

// Cursors are opaque to clients: today the base64url of a transaction id.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(transactionId: string): string {
  return Buffer.from(transactionId).toString('base64url');
}

export function decodeCursor(cursor: string): string | null {
  const id = Buffer.from(cursor, 'base64url').toString('utf8');
  return UUID.test(id) ? id : null;
}
