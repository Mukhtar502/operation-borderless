import { sql, type Kysely } from 'kysely';

// jsonb re-sorts object keys (shortest first), so stored responses came back with
// their fields scrambled. json keeps the text exactly as written, which is what a
// stored HTTP response needs: the API never queries inside it.
export const idempotencyResponseJson = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      ALTER TABLE idempotency_keys
        ALTER COLUMN response_body TYPE json USING response_body::json
    `.execute(db);
  },
  async down(db: Kysely<unknown>): Promise<void> {
    await sql`
      ALTER TABLE idempotency_keys
        ALTER COLUMN response_body TYPE jsonb USING response_body::jsonb
    `.execute(db);
  },
};
