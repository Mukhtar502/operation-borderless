import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Kysely } from 'kysely';
import { Migrator, type MigrationResultSet } from 'kysely/migration';
import { loadConfig } from '../config/env.js';
import { createDb } from './client.js';
import { initialSchema } from './migrations/001_initial_schema.js';
import { idempotencyResponseJson } from './migrations/002_idempotency_response_json.js';

// Migrations are registered statically (not read from disk) so the same list works
// from ts sources under tsx/Vitest and from compiled JS in the Docker image.
const migrations = {
  '001_initial_schema': initialSchema,
  '002_idempotency_response_json': idempotencyResponseJson,
};

function migrator(db: Kysely<unknown>): Migrator {
  return new Migrator({ db, provider: { getMigrations: () => Promise.resolve(migrations) } });
}

function assertSuccess({ error, results }: MigrationResultSet): void {
  for (const result of results ?? []) {
    console.info(`migration ${result.migrationName} (${result.direction}): ${result.status}`);
  }
  if (error) throw error instanceof Error ? error : new Error('Migration failed', { cause: error });
}

// Accepts any Kysely instance; migrations only issue raw SQL.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function migrateToLatest(db: Kysely<any>): Promise<void> {
  assertSuccess(await migrator(db).migrateToLatest());
}

async function main(): Promise<void> {
  const db = createDb(loadConfig().DATABASE_URL, 1);
  try {
    if (process.argv[2] === 'down')
      assertSuccess(await migrator(db as Kysely<unknown>).migrateDown());
    else await migrateToLatest(db);
  } finally {
    await db.destroy();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
