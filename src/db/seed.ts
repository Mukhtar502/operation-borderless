import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/env.js';
import { createServices, type Services } from '../container.js';
import { createLogger } from '../lib/logger.js';
import { OpenErApiProvider } from '../modules/rates/fx.provider.js';
import { FxService } from '../modules/rates/fx.service.js';
import { createDb, type DB } from './client.js';

/**
 * Optional demo data, created through the same services as real requests so it follows
 * every rule and appears in the ledger. Safe to run again: existing wallets are reused
 * and fixed idempotency keys stop any money moving twice.
 */
export async function seed(db: DB, services: Services) {
  const ensureWallet = async (identifier: { email: string } | { phone: string }) => {
    const existing = await db
      .selectFrom('wallets')
      .select('id')
      .where((eb) =>
        'email' in identifier
          ? eb('email', '=', identifier.email)
          : eb('phone', '=', identifier.phone),
      )
      .executeTakeFirst();
    return existing?.id ?? (await services.wallets.create(identifier)).id;
  };

  const ada = await ensureWallet({ email: 'ada@currencymesh.test' });
  const kofi = await ensureWallet({ phone: '+233241234567' });
  const amina = await ensureWallet({ email: 'amina@currencymesh.test' });

  await services.deposits.deposit({
    walletId: ada,
    idempotencyKey: 'seed-ada-usdx',
    currency: 'USDx',
    amount: '1000',
  });
  await services.deposits.deposit({
    walletId: ada,
    idempotencyKey: 'seed-ada-cngn',
    currency: 'cNGN',
    amount: '500000',
  });
  await services.deposits.deposit({
    walletId: kofi,
    idempotencyKey: 'seed-kofi-cghs',
    currency: 'cGHS',
    amount: '2500',
  });
  await services.swaps.swap({
    walletId: ada,
    idempotencyKey: 'seed-ada-swap',
    fromCurrency: 'USDx',
    toCurrency: 'EURx',
    amount: '100',
  });
  await services.transfers.transfer({
    idempotencyKey: 'seed-ada-to-amina',
    fromWalletId: ada,
    toWalletId: amina,
    sourceCurrency: 'USDx',
    destinationCurrency: 'cXAF',
    amount: '50',
  });

  return { ada, kofi, amina };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const db = createDb(config.DATABASE_URL, 2);
  const fx = new FxService(
    new OpenErApiProvider(config.FX_PROVIDER_URL, config.FX_TIMEOUT_MS),
    logger,
    { cacheTtlMs: config.FX_CACHE_TTL_SECONDS * 1000 },
  );
  try {
    const wallets = await seed(db, createServices({ db, fx }));
    console.info('Demo wallets ready:', wallets);
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
