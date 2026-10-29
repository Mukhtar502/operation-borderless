import type { Express } from 'express';
import { sql } from 'kysely';
import { afterAll, beforeEach, inject } from 'vitest';
import { createApp } from '../../src/app.js';
import { createDb, type DB } from '../../src/db/client.js';
import { createLogger } from '../../src/lib/logger.js';

export interface TestContext {
  db: DB;
  app: Express;
}

// Wires a real app to the test database and wipes user data before every test.
// System accounts (EXTERNAL, FX_POOL) are kept but zeroed so ledger checks start clean.
export function setupTestContext(): TestContext {
  const db = createDb(inject('databaseUrl'));
  const app = createApp({ db, logger: createLogger('silent') });

  beforeEach(async () => {
    await resetDatabase(db);
  });
  afterAll(async () => {
    await db.destroy();
  });

  return { db, app };
}

export async function resetDatabase(db: DB): Promise<void> {
  await sql`TRUNCATE idempotency_keys, ledger_entries, transactions`.execute(db);
  await db.deleteFrom('accounts').where('kind', '=', 'WALLET').execute();
  await db.updateTable('accounts').set({ balance: '0' }).execute();
  await db.deleteFrom('wallets').execute();
}
