import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { FxService } from '../../src/modules/rates/fx.service.js';
import { setupTestContext, testLogger } from '../helpers/context.js';
import { FakeFxProvider } from '../helpers/fake-fx.js';

const { app, db } = setupTestContext();

describe('security headers', () => {
  it('protects API responses and hides the framework', async () => {
    const res = await request(app).get('/v1/rates').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('lets Swagger UI load its inline assets', async () => {
    const res = await request(app).get('/docs/').expect(200);
    expect(res.headers['content-security-policy']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('API docs switch', () => {
  it('serves no docs when they are turned off, and the API still works', async () => {
    const fx = new FxService(new FakeFxProvider(), testLogger, { cacheTtlMs: 60_000 });
    const noDocs = createApp({ db, logger: testLogger, fx, docsEnabled: false });

    await request(noDocs).get('/docs/').expect(404);
    await request(noDocs).get('/docs/openapi.json').expect(404);
    await request(noDocs).get('/v1/rates').expect(200);
  });
});
