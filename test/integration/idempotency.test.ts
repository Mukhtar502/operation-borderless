import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { AppError, unprocessable } from '../../src/lib/errors.js';
import { IdempotencyService } from '../../src/modules/idempotency/idempotency.service.js';
import { setupTestContext } from '../helpers/context.js';

const { db } = setupTestContext();
const idempotency = new IdempotencyService(db);

/** A stand-in for real work: counts how many times it actually ran. */
function counter() {
  let runs = 0;
  return {
    get runs() {
      return runs;
    },
    handler: async () => {
      runs += 1;
      await sleep(50); // long enough for concurrent callers to overlap
      return { status: 201, body: { run: runs, at: new Date() } };
    },
  };
}

const request = (key: string, amount = '10', scope = 'wallet:a') => ({
  scope,
  key,
  fingerprint: { op: 'DEPOSIT', amount },
});

describe('IdempotencyService', () => {
  it('runs the work once and replays the same response on retry', async () => {
    const work = counter();
    const first = await idempotency.run(request('k1'), work.handler);
    const retry = await idempotency.run(request('k1'), work.handler);

    expect(work.runs).toBe(1);
    expect(first).toMatchObject({ status: 201, replayed: false });
    expect(retry).toMatchObject({ status: 201, replayed: true });
    expect(retry.body).toEqual(first.body);
  });

  it('runs the work once when the same key arrives concurrently', async () => {
    const work = counter();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => idempotency.run(request('k-race'), work.handler)),
    );

    expect(work.runs).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(new Set(results.map((r) => JSON.stringify(r.body))).size).toBe(1);
  });

  it('rejects the same key with a different request', async () => {
    const work = counter();
    await idempotency.run(request('k2', '10'), work.handler);
    const error = await idempotency
      .run(request('k2', '99'), work.handler)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ status: 422, code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(work.runs).toBe(1);
  });

  it('does not keep the key when the work fails, so a retry runs again', async () => {
    const failing = () => Promise.reject(unprocessable('INSUFFICIENT_FUNDS', 'no money'));
    await expect(idempotency.run(request('k3'), failing)).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });

    const work = counter();
    const retry = await idempotency.run(request('k3'), work.handler);
    expect(work.runs).toBe(1);
    expect(retry.replayed).toBe(false);
  });

  it('treats the same key in another scope as a different request', async () => {
    const work = counter();
    await idempotency.run(request('shared', '10', 'wallet:a'), work.handler);
    const other = await idempotency.run(request('shared', '10', 'wallet:b'), work.handler);

    expect(work.runs).toBe(2);
    expect(other.replayed).toBe(false);
  });

  it('rolls back the work itself if saving the response fails', async () => {
    // The handler writes inside the same transaction; if anything after it fails,
    // its write must disappear too.
    await expect(
      idempotency.run(request('k4'), async (trx) => {
        await trx
          .insertInto('wallets')
          .values({ email: 'ghost@example.com', phone: null })
          .execute();
        return { status: 201, body: { bad: 1n } }; // BigInt cannot be JSON-serialised
      }),
    ).rejects.toThrow();

    const ghost = await db
      .selectFrom('wallets')
      .select('id')
      .where('email', '=', 'ghost@example.com')
      .executeTakeFirst();
    expect(ghost).toBeUndefined();
  });
});
