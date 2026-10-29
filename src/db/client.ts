import { Kysely, PostgresDialect, type Transaction } from 'kysely';
import { Pool } from 'pg';
import type { Database } from './schema.js';

export type DB = Kysely<Database>;
export type Trx = Transaction<Database>;

export function createDb(connectionString: string, maxConnections = 10): DB {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString, max: maxConnections }),
    }),
  });
}
