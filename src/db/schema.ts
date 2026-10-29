import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';

// NUMERIC columns are read and written as strings so no value ever passes through
// a JavaScript float. Arithmetic happens in decimal.js (see src/lib/money.ts).
type Numeric = ColumnType<string, string, string>;
type CreatedAt = ColumnType<Date, Date | string | undefined, never>;

export type CurrencyCode = 'cNGN' | 'cGHS' | 'cXAF' | 'USDx' | 'EURx';
export type TransactionType = 'DEPOSIT' | 'SWAP' | 'TRANSFER';
export type AccountKind = 'WALLET' | 'EXTERNAL' | 'FX_POOL';

export interface CurrenciesTable {
  code: CurrencyCode;
  name: string;
  decimals: number;
  fiat_code: string;
}

export interface WalletsTable {
  id: Generated<string>;
  email: string | null;
  phone: string | null;
  created_at: CreatedAt;
}

export interface AccountsTable {
  id: Generated<string>;
  wallet_id: string | null;
  kind: AccountKind;
  currency: CurrencyCode;
  balance: ColumnType<string, string | undefined, string>;
  created_at: CreatedAt;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface TransactionsTable {
  id: Generated<string>;
  type: TransactionType;
  from_wallet_id: string | null;
  to_wallet_id: string;
  source_currency: CurrencyCode;
  source_amount: Numeric;
  destination_currency: CurrencyCode;
  destination_amount: Numeric;
  fx_rate: Numeric;
  fx_rate_source: string;
  fx_rate_fetched_at: ColumnType<Date, Date | string, never>;
  idempotency_key: string | null;
  created_at: CreatedAt;
}

export interface LedgerEntriesTable {
  id: ColumnType<string, never, never>;
  transaction_id: string;
  account_id: string;
  amount: Numeric;
  balance_after: Numeric;
  created_at: CreatedAt;
}

export interface IdempotencyKeysTable {
  scope: string;
  key: string;
  request_hash: string;
  response_status: number;
  response_body: ColumnType<unknown, string, string>;
  transaction_id: string | null;
  created_at: CreatedAt;
}

export interface Database {
  currencies: CurrenciesTable;
  wallets: WalletsTable;
  accounts: AccountsTable;
  transactions: TransactionsTable;
  ledger_entries: LedgerEntriesTable;
  idempotency_keys: IdempotencyKeysTable;
}

export type Wallet = Selectable<WalletsTable>;
export type Account = Selectable<AccountsTable>;
export type Transaction = Selectable<TransactionsTable>;
export type NewTransaction = Insertable<TransactionsTable>;
export type LedgerEntry = Selectable<LedgerEntriesTable>;
