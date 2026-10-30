import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { api, type ErrorBody } from '../helpers/api.js';
import { setupTestContext } from '../helpers/context.js';

// Error messages are read by people (in Swagger, logs and client apps), so their exact
// wording is part of the contract: plain English, naming the field, no library syntax.
const { app } = setupTestContext();
const client = api(app);

const errorOf = (res: request.Response) => (res.body as ErrorBody).error;

describe('validation messages', () => {
  it.each([
    [
      { currency: 'BTC', amount: '1' },
      'currency',
      'currency must be one of: cNGN, cGHS, cXAF, USDx, EURx',
    ],
    [{ currency: 'USDx', amount: 10 }, 'amount', 'amount must be a decimal string, e.g. "100.50"'],
    [{ currency: 'USDx' }, 'amount', 'amount is required'],
    [{ amount: '1' }, 'currency', 'currency is required'],
    [{ currency: 'USDx', amount: '1', fee: '0' }, 'fee', 'fee is not a recognised field'],
  ])('deposit %j -> %s: %s', async (body, path, message) => {
    const wallet = await client.createWallet('v@example.com');
    const res = await client.deposit(wallet, body).expect(400);
    expect(errorOf(res)).toMatchObject({
      code: 'VALIDATION_ERROR',
      message,
      details: [{ path, message }],
    });
  });

  it('summarises several problems and lists each one', async () => {
    const wallet = await client.createWallet('many@example.com');
    const res = await client.deposit(wallet, {}).expect(400);
    expect(errorOf(res)).toMatchObject({
      message: '2 fields are invalid; see details',
      details: [
        { path: 'currency', message: 'currency is required' },
        { path: 'amount', message: 'amount is required' },
      ],
    });
  });

  it.each([
    ['/v1/wallets/abc', 'walletId must be a valid UUID'],
    ['/v1/wallets/{w}/transactions?limit=500', 'limit must be at most 100'],
    ['/v1/wallets/{w}/transactions?limit=0', 'limit must be at least 1'],
    ['/v1/wallets/{w}/transactions?limit=abc', 'limit must be a number'],
    ['/v1/wallets/{w}/transactions?limit=1.5', 'limit must be a whole number'],
    ['/v1/wallets/{w}/transactions?type=REFUND', 'type must be one of: DEPOSIT, SWAP, TRANSFER'],
    ['/v1/wallets/{w}/transactions?page=2', 'page is not a recognised field'],
  ])('GET %s -> %s', async (url, message) => {
    const wallet = await client.createWallet('q@example.com');
    const res = await request(app).get(url.replace('{w}', wallet)).expect(400);
    expect(errorOf(res).message).toBe(message);
  });

  it.each([
    [{}, 'Provide an email or a phone number'],
    [{ email: 'nope' }, 'email must be a valid email address'],
    [{ email: 5 }, 'email must be a string'],
    [[1], 'Request body must be a JSON object'],
  ])('POST /v1/wallets %j -> %s', async (body, message) => {
    const res = await request(app).post('/v1/wallets').send(body).expect(400);
    expect(errorOf(res).message).toBe(message);
  });

  it('never leaks validation-library syntax', async () => {
    const wallet = await client.createWallet('leak@example.com');
    const responses = await Promise.all([
      client.deposit(wallet, { currency: 'BTC', amount: 1, x: 1 }),
      request(app).get(`/v1/wallets/${wallet}/transactions?limit=abc&type=X`),
      request(app).post('/v1/wallets').send({ email: 1, phone: [] }),
    ]);
    for (const res of responses) {
      const { message, details } = errorOf(res) as {
        message: string;
        details: { message: string }[];
      };
      for (const text of [message, ...details.map((d) => d.message)]) {
        expect(text).not.toMatch(/Invalid input|expected \w+, received|"\|"|NaN|<=|>=/);
      }
    }
  });

  it('reports one message per field, the root cause', async () => {
    const res = await request(app).post('/v1/wallets').send({ email: 1, phone: [] }).expect(400);
    expect(errorOf(res).details).toEqual([
      { path: 'email', message: 'email must be a string' },
      { path: 'phone', message: 'phone must be a string' },
    ]);
  });
});

describe('HTTP semantics', () => {
  it('answers a known URL with the wrong method with 405 and an Allow header', async () => {
    const wallet = await client.createWallet('m@example.com');
    const res = await request(app).delete(`/v1/wallets/${wallet}`).expect(405);
    expect(res.headers.allow).toBe('GET');
    expect(errorOf(res)).toMatchObject({
      code: 'METHOD_NOT_ALLOWED',
      message: 'DELETE is not allowed here; use GET',
    });
    await request(app).get('/v1/transfers').expect(405).expect('Allow', 'POST');
  });

  it('still answers unknown URLs with 404', async () => {
    const res = await request(app).get('/v1/nope').expect(404);
    expect(errorOf(res).code).toBe('ROUTE_NOT_FOUND');
  });

  it('rejects a body that is not JSON with 415', async () => {
    const res = await request(app)
      .post('/v1/wallets')
      .set('Content-Type', 'text/plain')
      .send('email=a@b.co')
      .expect(415);
    expect(errorOf(res).code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('points to the new transaction with a Location header, on replays too', async () => {
    const wallet = await client.createWallet('loc@example.com');
    const first = await client
      .deposit(wallet, { currency: 'USDx', amount: '1' }, 'loc')
      .expect(201);
    const replay = await client
      .deposit(wallet, { currency: 'USDx', amount: '1' }, 'loc')
      .expect(201);
    const { id } = (first.body as { data: { id: string } }).data;

    expect(first.headers.location).toBe(`/v1/transactions/${id}`);
    expect(replay.headers.location).toBe(first.headers.location);
    await request(app).get(String(first.headers.location)).expect(200);
  });

  it('explains how to recover from a bad cursor', async () => {
    const wallet = await client.createWallet('c@example.com');
    const res = await request(app).get(`/v1/wallets/${wallet}/transactions?cursor=abc`).expect(400);
    expect(errorOf(res).message).toBe(
      'cursor is not valid; use pagination.nextCursor from a previous response',
    );
  });
});
