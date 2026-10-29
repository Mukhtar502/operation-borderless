import { existsSync } from 'node:fs';
import { z } from 'zod';

// Load .env for host runs; Docker and CI inject real environment variables instead.
if (existsSync('.env')) process.loadEnvFile('.env');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url(),
  FX_PROVIDER_URL: z.url().default('https://open.er-api.com/v6/latest/USD'),
  FX_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  FX_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
