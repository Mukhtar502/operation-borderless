import { describe, expect, it } from 'vitest';
import { CURRENCIES } from '../../src/domain/currencies.js';
import { setupTestContext } from '../helpers/context.js';

const { db } = setupTestContext();

const byCode = (a: { code: string }, b: { code: string }) =>
  a.code < b.code ? -1 : a.code > b.code ? 1 : 0;

describe('currencies', () => {
  it('code list matches the currencies table', async () => {
    const rows = await db.selectFrom('currencies').selectAll().execute();
    const fromCode = Object.values(CURRENCIES).map(({ code, name, decimals, fiatCode }) => ({
      code,
      name,
      decimals,
      fiat_code: fiatCode,
    }));
    expect(rows.sort(byCode)).toEqual(fromCode.sort(byCode));
  });
});
