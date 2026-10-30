import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import { sql } from 'kysely';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { createServices } from './container.js';
import type { DB } from './db/client.js';
import { buildOpenApiDocument } from './docs/openapi.js';
import type { Logger } from './lib/logger.js';
import { errorHandler } from './middleware/error.middleware.js';
import { notFoundHandler } from './middleware/not-found.middleware.js';
import { requireJsonBody } from './middleware/require-json.middleware.js';
import type { FxService } from './modules/rates/fx.service.js';
import { apiRoutes } from './routes/index.js';

export interface AppDeps {
  db: DB;
  logger: Logger;
  fx: FxService;
}

export function createApp({ db, logger, fx }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  // 1. Request plumbing: logging with a request id, JSON bodies only.
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
  app.use(requireJsonBody);
  app.use(express.json({ limit: '16kb' }));

  // 2. Health checks. Liveness: the process is up. Readiness: it can reach the database.
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

  // 3. The API.
  app.use('/v1', apiRoutes(createServices({ db, fx })));

  // 4. Interactive docs, generated from the same Zod schemas that validate requests.
  const openApi = buildOpenApiDocument();
  app.get('/docs/openapi.json', (_req, res) => {
    res.json(openApi);
  });
  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(openApi, { customSiteTitle: 'CurrencyMesh API' }),
  );

  // 5. Anything else is a 404; every error leaves through one handler.
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
