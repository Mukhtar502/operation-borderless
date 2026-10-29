import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { setupTestContext } from '../helpers/context.js';

const { app, db } = setupTestContext();

interface WalletBody {
  data: {
    id: string;
    email: string | null;
    phone: string | null;
    balances: { currency: string; amount: string }[];
  };
}
interface ErrorBody {
  error: { code: string };
}

describe('POST /v1/wallets', () => {
  it('creates a wallet with a zero balance in every currency', async () => {
    const res = await request(app)
      .post('/v1/wallets')
      .send({ email: 'Ada@Example.com' })
      .expect(201);
    const { data } = res.body as WalletBody;

    expect(res.headers.location).toBe(`/v1/wallets/${data.id}`);
    expect(data.email).toBe('ada@example.com');
    expect(data.phone).toBeNull();
    expect(data.balances).toEqual([
      { currency: 'cNGN', amount: '0.000000' },
      { currency: 'cGHS', amount: '0.000000' },
      { currency: 'cXAF', amount: '0.000000' },
      { currency: 'USDx', amount: '0.000000' },
      { currency: 'EURx', amount: '0.000000' },
    ]);
  });

  it('creates a wallet with a phone stored in E.164', async () => {
    const res = await request(app)
      .post('/v1/wallets')
      .send({ phone: '+234 801 234 5678' })
      .expect(201);
    expect((res.body as WalletBody).data.phone).toBe('+2348012345678');
  });

  it('rejects a second wallet for the same email, ignoring case and spaces', async () => {
    await request(app).post('/v1/wallets').send({ email: 'ada@example.com' }).expect(201);
    const res = await request(app)
      .post('/v1/wallets')
      .send({ email: ' ADA@example.com ' })
      .expect(409);
    expect((res.body as ErrorBody).error.code).toBe('WALLET_ALREADY_EXISTS');
  });

  it('rejects a second wallet for the same phone written differently', async () => {
    await request(app).post('/v1/wallets').send({ phone: '+2348012345678' }).expect(201);
    await request(app).post('/v1/wallets').send({ phone: '+234-801-234-5678' }).expect(409);
  });

  it('creates exactly one wallet when the same email is sent concurrently', async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app).post('/v1/wallets').send({ email: 'race@example.com' }),
      ),
    );
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([201, ...Array<number>(9).fill(409)]);

    const count = await db
      .selectFrom('wallets')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    expect(count.n).toBe('1');
  });

  it.each([
    ['no identifier', {}],
    ['an invalid email', { email: 'not-an-email' }],
    ['a local phone number', { phone: '08012345678' }],
    ['unknown fields', { email: 'a@b.co', nickname: 'x' }],
  ])('rejects %s with 400', async (_label, body) => {
    await request(app).post('/v1/wallets').send(body).expect(400);
  });
});

describe('GET /v1/wallets/:walletId', () => {
  it('returns the wallet', async () => {
    const created = await request(app).post('/v1/wallets').send({ email: 'a@b.co' }).expect(201);
    const { id } = (created.body as WalletBody).data;
    const res = await request(app).get(`/v1/wallets/${id}`).expect(200);
    expect((res.body as WalletBody).data.id).toBe(id);
  });

  it('returns 404 for an unknown wallet', async () => {
    const res = await request(app)
      .get('/v1/wallets/00000000-0000-4000-8000-000000000000')
      .expect(404);
    expect((res.body as ErrorBody).error.code).toBe('WALLET_NOT_FOUND');
  });

  it('returns 400 for a malformed id', async () => {
    await request(app).get('/v1/wallets/not-a-uuid').expect(400);
  });
});
