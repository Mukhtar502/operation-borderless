import { describe, expect, it } from 'vitest';
import { createServices } from '../../src/container.js';
import { seed } from '../../src/db/seed.js';
import { FxService } from '../../src/modules/rates/fx.service.js';
import { api } from '../helpers/api.js';
import { setupTestContext, testLogger } from '../helpers/context.js';
import { FakeFxProvider } from '../helpers/fake-fx.js';
import { expectLedgerConsistent } from '../helpers/ledger.js';

const { app, db } = setupTestContext();
const client = api(app);
const fx = new FxService(new FakeFxProvider(), testLogger, { cacheTtlMs: 60_000 });

describe('seed', () => {
  it('creates demo wallets with real, balanced transactions', async () => {
    const { ada, kofi, amina } = await seed(db, createServices({ db, fx }));

    expect(await client.balance(ada, 'USDx')).toBe('850.000000'); // 1000 - 100 - 50
    expect(await client.balance(ada, 'EURx')).toBe('80.000000'); // 100 at 0.8
    expect(await client.balance(kofi, 'cGHS')).toBe('2500.000000');
    expect(await client.balance(amina, 'cXAF')).toBe('30000.000000'); // 50 at 600
    await expectLedgerConsistent(db);
  });

  it('changes nothing when it runs again', async () => {
    const first = await seed(db, createServices({ db, fx }));
    const second = await seed(db, createServices({ db, fx }));

    expect(second).toEqual(first);
    expect(await client.balance(first.ada, 'USDx')).toBe('850.000000');
    const count = await db
      .selectFrom('transactions')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    expect(count.n).toBe('5');
  });
});
