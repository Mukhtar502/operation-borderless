import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createDb } from './db/client.js';
import { createLogger } from './lib/logger.js';
import { OpenErApiProvider } from './modules/rates/fx.provider.js';
import { FxService } from './modules/rates/fx.service.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const db = createDb(config.DATABASE_URL);
const fx = new FxService(
  new OpenErApiProvider(config.FX_PROVIDER_URL, config.FX_TIMEOUT_MS),
  logger,
  {
    cacheTtlMs: config.FX_CACHE_TTL_SECONDS * 1000,
    maxStaleMs: config.FX_MAX_STALE_SECONDS * 1000,
  },
);
const app = createApp({ db, logger, fx });

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'CurrencyMesh API listening');
  // Warm the FX cache so the first real request does not pay for a cold connection.
  // getSnapshot() never throws; on failure it falls back and retries later.
  void fx.getSnapshot().then((snapshot) => {
    logger.info({ source: snapshot.source, provider: snapshot.provider }, 'FX rates loaded');
  });
});

// Stop accepting connections, let in-flight requests finish, then close the pool.
function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  server.close(() => {
    db.destroy()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        logger.error({ err }, 'error while closing database pool');
        process.exit(1);
      });
  });
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
