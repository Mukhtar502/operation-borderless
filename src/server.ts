import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { createLogger } from './lib/logger.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const db = createDb(config.DATABASE_URL);
const app = createApp({ db, logger });

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'Borderless API listening');
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
