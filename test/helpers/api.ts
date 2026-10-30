import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { expect } from 'vitest';

export interface TransactionBody {
  data: {
    id: string;
    type: string;
    fromWalletId: string | null;
    toWalletId: string;
    source: { currency: string; amount: string };
    destination: { currency: string; amount: string };
    fx: { rate: string; source: string; provider: string | null; refreshedAt: string };
    createdAt: string;
  };
}

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** Small client for the API under test, so each test reads as the steps it checks. */
export function api(app: Express) {
  return {
    async createWallet(email: string): Promise<string> {
      const res = await request(app).post('/v1/wallets').send({ email }).expect(201);
      return (res.body as { data: { id: string } }).data.id;
    },

    deposit(walletId: string, body: object, key: string | null = randomUUID()) {
      const req = request(app).post(`/v1/wallets/${walletId}/deposits`);
      if (key !== null) void req.set('Idempotency-Key', key);
      return req.send(body);
    },

    swap(walletId: string, body: object, key: string = randomUUID()) {
      return request(app)
        .post(`/v1/wallets/${walletId}/swaps`)
        .set('Idempotency-Key', key)
        .send(body);
    },

    transfer(body: object, key: string = randomUUID()) {
      return request(app).post('/v1/transfers').set('Idempotency-Key', key).send(body);
    },

    /** Creates a wallet and funds it in one currency. */
    async fundedWallet(email: string, currency: string, amount: string): Promise<string> {
      const id = await this.createWallet(email);
      await this.deposit(id, { currency, amount }).expect(201);
      return id;
    },

    async balance(walletId: string, currency: string): Promise<string> {
      const res = await request(app).get(`/v1/wallets/${walletId}`).expect(200);
      const { balances } = (
        res.body as { data: { balances: { currency: string; amount: string }[] } }
      ).data;
      const line = balances.find((b) => b.currency === currency);
      expect(line, `balance line for ${currency}`).toBeDefined();
      return line?.amount ?? '';
    },
  };
}
