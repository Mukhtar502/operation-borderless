import { sql, type Kysely } from 'kysely';

// Raw SQL is deliberate: the constraints and triggers below are the core of the
// money-safety story and should read exactly as Postgres will enforce them.
const up = [
  sql`CREATE TYPE transaction_type AS ENUM ('DEPOSIT', 'SWAP', 'TRANSFER')`,
  // WALLET: user-owned. EXTERNAL: simulated on-ramp that funds deposits (goes negative,
  // representing total supply issued). FX_POOL: counterparty for every conversion.
  sql`CREATE TYPE account_kind AS ENUM ('WALLET', 'EXTERNAL', 'FX_POOL')`,

  sql`
    CREATE TABLE currencies (
      code      text PRIMARY KEY,
      name      text NOT NULL,
      decimals  smallint NOT NULL CHECK (decimals BETWEEN 0 AND 6),
      fiat_code char(3) NOT NULL
    )`,
  sql`
    INSERT INTO currencies (code, name, decimals, fiat_code) VALUES
      ('cNGN', 'Nigerian Naira stablecoin', 6, 'NGN'),
      ('cGHS', 'Ghanaian Cedi stablecoin', 6, 'GHS'),
      ('cXAF', 'Central African CFA franc stablecoin', 6, 'XAF'),
      ('USDx', 'US Dollar stablecoin', 6, 'USD'),
      ('EURx', 'Euro stablecoin', 6, 'EUR')`,

  sql`
    CREATE TABLE wallets (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email      text UNIQUE CHECK (email = lower(email)),
      phone      text UNIQUE CHECK (phone ~ '^\\+[1-9][0-9]{6,14}$'),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT wallets_identifier_required CHECK (email IS NOT NULL OR phone IS NOT NULL)
    )`,

  sql`
    CREATE TABLE accounts (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      wallet_id  uuid REFERENCES wallets (id) ON DELETE RESTRICT,
      kind       account_kind NOT NULL,
      currency   text NOT NULL REFERENCES currencies (code),
      balance    numeric(38, 6) NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT accounts_wallet_kind CHECK ((kind = 'WALLET') = (wallet_id IS NOT NULL)),
      CONSTRAINT accounts_wallet_non_negative CHECK (kind <> 'WALLET' OR balance >= 0)
    )`,
  sql`CREATE UNIQUE INDEX accounts_wallet_currency_key ON accounts (wallet_id, currency) WHERE wallet_id IS NOT NULL`,
  sql`CREATE UNIQUE INDEX accounts_system_currency_key ON accounts (kind, currency) WHERE wallet_id IS NULL`,
  sql`
    INSERT INTO accounts (kind, currency)
    SELECT k.kind, c.code
    FROM currencies c
    CROSS JOIN (VALUES ('EXTERNAL'::account_kind), ('FX_POOL'::account_kind)) AS k (kind)`,

  sql`
    CREATE TABLE transactions (
      id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      type                 transaction_type NOT NULL,
      from_wallet_id       uuid REFERENCES wallets (id),
      to_wallet_id         uuid NOT NULL REFERENCES wallets (id),
      source_currency      text NOT NULL REFERENCES currencies (code),
      source_amount        numeric(38, 6) NOT NULL CHECK (source_amount > 0),
      destination_currency text NOT NULL REFERENCES currencies (code),
      destination_amount   numeric(38, 6) NOT NULL CHECK (destination_amount > 0),
      fx_rate              numeric(38, 18) NOT NULL CHECK (fx_rate > 0),
      fx_rate_source       text NOT NULL,
      fx_rate_fetched_at   timestamptz NOT NULL,
      idempotency_key      text,
      created_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT transactions_shape CHECK (
        (type = 'DEPOSIT'  AND from_wallet_id IS NULL
                           AND source_currency = destination_currency) OR
        (type = 'SWAP'     AND from_wallet_id = to_wallet_id
                           AND source_currency <> destination_currency) OR
        (type = 'TRANSFER' AND from_wallet_id IS NOT NULL
                           AND from_wallet_id <> to_wallet_id)
      )
    )`,
  // Keyset pagination of a wallet's history: (created_at, id) DESC per side.
  sql`CREATE INDEX transactions_from_wallet_idx ON transactions (from_wallet_id, created_at DESC, id DESC)`,
  sql`CREATE INDEX transactions_to_wallet_idx ON transactions (to_wallet_id, created_at DESC, id DESC)`,

  sql`
    CREATE TABLE ledger_entries (
      id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      transaction_id uuid NOT NULL REFERENCES transactions (id),
      account_id     uuid NOT NULL REFERENCES accounts (id),
      amount         numeric(38, 6) NOT NULL CHECK (amount <> 0),
      balance_after  numeric(38, 6) NOT NULL,
      created_at     timestamptz NOT NULL DEFAULT now()
    )`,
  sql`CREATE INDEX ledger_entries_transaction_idx ON ledger_entries (transaction_id)`,
  sql`CREATE INDEX ledger_entries_account_idx ON ledger_entries (account_id, id)`,

  // The ledger is append-only: corrections are new transactions, never edits.
  sql`
    CREATE FUNCTION ledger_entries_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'ledger_entries is append-only';
    END $$`,
  sql`
    CREATE TRIGGER ledger_entries_no_update_delete
      BEFORE UPDATE OR DELETE ON ledger_entries
      FOR EACH ROW EXECUTE FUNCTION ledger_entries_immutable()`,

  // Double-entry invariant, checked at COMMIT: within every transaction the entries
  // for each currency must sum to exactly zero.
  sql`
    CREATE FUNCTION ledger_entries_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      unbalanced text;
    BEGIN
      SELECT a.currency INTO unbalanced
      FROM ledger_entries e
      JOIN accounts a ON a.id = e.account_id
      WHERE e.transaction_id = NEW.transaction_id
      GROUP BY a.currency
      HAVING sum(e.amount) <> 0
      LIMIT 1;
      IF unbalanced IS NOT NULL THEN
        RAISE EXCEPTION 'unbalanced ledger for transaction % in %', NEW.transaction_id, unbalanced;
      END IF;
      RETURN NULL;
    END $$`,
  sql`
    CREATE CONSTRAINT TRIGGER ledger_entries_must_balance
      AFTER INSERT ON ledger_entries
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION ledger_entries_balanced()`,

  sql`
    CREATE TABLE idempotency_keys (
      scope           text NOT NULL,
      key             text NOT NULL CHECK (length(key) BETWEEN 1 AND 255),
      request_hash    char(64) NOT NULL,
      response_status smallint NOT NULL,
      response_body   jsonb NOT NULL,
      transaction_id  uuid REFERENCES transactions (id),
      created_at      timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (scope, key)
    )`,
  sql`CREATE INDEX idempotency_keys_created_at_idx ON idempotency_keys (created_at)`,
];

const down = [
  sql`DROP TABLE IF EXISTS idempotency_keys`,
  sql`DROP TABLE IF EXISTS ledger_entries`,
  sql`DROP FUNCTION IF EXISTS ledger_entries_balanced`,
  sql`DROP FUNCTION IF EXISTS ledger_entries_immutable`,
  sql`DROP TABLE IF EXISTS transactions`,
  sql`DROP TABLE IF EXISTS accounts`,
  sql`DROP TABLE IF EXISTS wallets`,
  sql`DROP TABLE IF EXISTS currencies`,
  sql`DROP TYPE IF EXISTS account_kind`,
  sql`DROP TYPE IF EXISTS transaction_type`,
];

export const initialSchema = {
  async up(db: Kysely<unknown>): Promise<void> {
    for (const statement of up) await statement.execute(db);
  },
  async down(db: Kysely<unknown>): Promise<void> {
    for (const statement of down) await statement.execute(db);
  },
};
