import { Kysely, PostgresDialect, type Transaction } from 'kysely';
import { Pool } from 'pg';
import type { Database } from './schema.js';

export type DB = Kysely<Database>;
export type Trx = Transaction<Database>;

export function createDb(connectionString: string, maxConnections = 10): DB {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString,
        max: maxConnections,
        // Fail fast instead of hanging when the database is unreachable or overloaded.
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
        // A stuck query or forgotten transaction must not hold account locks forever.
        statement_timeout: 15_000,
        idle_in_transaction_session_timeout: 15_000,
      }),
    }),
  });
}
