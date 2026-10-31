import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/env.js';

const base = { DATABASE_URL: 'postgres://user:pass@localhost:5432/db' };

describe('loadConfig', () => {
  it('turns API docs on by default outside production', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'development' }).docsEnabled).toBe(true);
  });

  it('turns API docs off by default in production', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).docsEnabled).toBe(false);
  });

  it('lets ENABLE_DOCS override the default', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'production', ENABLE_DOCS: 'true' }).docsEnabled).toBe(
      true,
    );
    expect(loadConfig({ ...base, NODE_ENV: 'development', ENABLE_DOCS: 'false' }).docsEnabled).toBe(
      false,
    );
  });

  it('refuses to start with a missing or invalid DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/Invalid environment configuration/);
    expect(() => loadConfig({ DATABASE_URL: 'nope' })).toThrow(/DATABASE_URL/);
  });
});
