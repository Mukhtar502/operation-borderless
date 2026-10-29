import type { Express } from 'express';
import { sql } from 'kysely';
import { afterAll, beforeEach, inject } from 'vitest';
import { createApp } from '../../src/app.js';
import { createDb, type DB } from '../../src/db/client.js';
import { createLogger } from '../../src/lib/logger.js';
import { FxService } from '../../src/modules/fx/fx.service.js';
import { FakeFxProvider } from './fake-fx.js';

export const testLogger = createLogger('silent');

export interface TestContext {
  db: DB;
  app: Express;
  fxProvider: FakeFxProvider;
}

// Wires a real app to the test database and wipes user data before every test.
// System accounts (EXTERNAL, FX_POOL) are kept but zeroed so ledger checks start clean.
export function setupTestContext(): TestContext {
  const db = createDb(inject('databaseUrl'));
  const fxProvider = new FakeFxProvider();
  const fx = new FxService(fxProvider, testLogger, { cacheTtlMs: 60_000 });
  const app = createApp({ db, logger: testLogger, fx });

  beforeEach(async () => {
    await resetDatabase(db);
  });
  afterAll(async () => {
    await db.destroy();
  });

  return { db, app, fxProvider };
}

export async function resetDatabase(db: DB): Promise<void> {
  await sql`TRUNCATE idempotency_keys, ledger_entries, transactions`.execute(db);
  await db.deleteFrom('accounts').where('kind', '=', 'WALLET').execute();
  await db.updateTable('accounts').set({ balance: '0' }).execute();
  await db.deleteFrom('wallets').execute();
}
