import { existsSync } from 'node:fs';
import { z } from 'zod';

// Load .env for host runs; Docker injects real environment variables instead.
if (existsSync('.env')) process.loadEnvFile('.env');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.url(),
    DB_POOL_MAX: z.coerce.number().int().positive().default(10),
    FX_PROVIDER_URL: z.url().default('https://open.er-api.com/v6/latest/USD'),
    FX_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    FX_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    FX_MAX_STALE_SECONDS: z.coerce.number().int().positive().default(172_800),
    ENABLE_DOCS: z.enum(['true', 'false']).optional(),
  })
  .transform(({ ENABLE_DOCS, ...env }) => ({
    ...env,
    // API docs are on by default, except in production where they must be asked for.
    docsEnabled: ENABLE_DOCS ? ENABLE_DOCS === 'true' : env.NODE_ENV !== 'production',
  }));

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
