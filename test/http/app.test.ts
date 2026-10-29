import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { setupTestContext } from '../helpers/context.js';

const { app } = setupTestContext();

describe('app skeleton', () => {
  it('reports liveness', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('reports readiness when the database is reachable', async () => {
    const res = await request(app).get('/ready').expect(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('returns the standard error envelope for unknown routes', async () => {
    const res = await request(app).get('/nope').expect(404);
    expect(res.body).toEqual({
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'No route for GET /nope',
        requestId: expect.any(String) as unknown,
      },
    });
  });

  it('echoes a caller-supplied X-Request-Id', async () => {
    const res = await request(app).get('/nope').set('X-Request-Id', 'trace-123').expect(404);
    expect(res.headers['x-request-id']).toBe('trace-123');
    expect((res.body as { error: { requestId: string } }).error.requestId).toBe('trace-123');
  });

  it('rejects malformed JSON with 400 INVALID_JSON', async () => {
    const res = await request(app)
      .post('/health')
      .set('Content-Type', 'application/json')
      .send('{bad')
      .expect(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('INVALID_JSON');
  });
});
