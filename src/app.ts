import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import { sql } from 'kysely';
import { pinoHttp } from 'pino-http';
import type { DB } from './db/client.js';
import { errorHandler, notFoundHandler } from './http/error-handler.js';
import type { Logger } from './lib/logger.js';
import { walletRoutes } from './modules/wallets/wallet.routes.js';
import { WalletService } from './modules/wallets/wallet.service.js';

export interface AppDeps {
  db: DB;
  logger: Logger;
}

export function createApp({ db, logger }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use(
    pinoHttp({
      logger,
      // Honour a caller-supplied correlation id, otherwise mint one; echo it back.
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id =
          typeof incoming === 'string' && /^[\w-]{1,64}$/.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );
  app.use(express.json({ limit: '16kb' }));

  // Liveness: the process is up. Readiness: it can reach the database.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/ready', async (_req, res) => {
    try {
      await sql`SELECT 1`.execute(db);
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  const wallets = new WalletService(db);
  app.use('/v1', walletRoutes(wallets));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
