import { sql } from 'kysely';
import { expect } from 'vitest';
import type { DB } from '../../src/db/client.js';

/**
 * Checks the two rules that keep the books honest:
 * - every account balance equals the sum of its ledger entries
 * - every transaction's entries add up to zero in each currency
 */
export async function expectLedgerConsistent(db: DB): Promise<void> {
  const driftedAccounts = await sql<{ id: string }>`
    SELECT a.id
    FROM accounts a
    LEFT JOIN ledger_entries e ON e.account_id = a.id
    GROUP BY a.id, a.balance
    HAVING a.balance <> COALESCE(sum(e.amount), 0)
  `.execute(db);
  expect(driftedAccounts.rows, 'accounts whose balance differs from their entries').toEqual([]);

  const unbalanced = await sql<{ transaction_id: string }>`
    SELECT e.transaction_id
    FROM ledger_entries e
    JOIN accounts a ON a.id = e.account_id
    GROUP BY e.transaction_id, a.currency
    HAVING sum(e.amount) <> 0
  `.execute(db);
  expect(unbalanced.rows, 'transactions whose entries do not sum to zero').toEqual([]);
}
