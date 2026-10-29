import { createHash } from 'node:crypto';
import type { DB, Trx } from '../../db/client.js';
import { unprocessable } from '../../lib/errors.js';

export interface IdempotentRequest {
  /** Who the key belongs to, e.g. "wallet:<id>". The same key in another scope is unrelated. */
  scope: string;
  key: string;
  /** Everything that defines the request. Reusing a key with a different fingerprint is rejected. */
  fingerprint: Record<string, unknown>;
}

export interface HandlerResult<T> {
  status: number;
  body: T;
  transactionId?: string | null;
}

export interface IdempotentResponse<T> {
  status: number;
  body: T;
  /** True when this response was replayed from an earlier request with the same key. */
  replayed: boolean;
}

/**
 * Makes a write safe to retry. The key is claimed, the work is done and the response
 * is saved in ONE database transaction:
 *
 * - First request: the INSERT claims the key, the handler runs, the response is stored.
 * - Retry after success: the INSERT finds the key; the stored response is replayed.
 * - Same key at the same moment: Postgres makes the second INSERT wait for the first
 *   transaction to finish, then it replays the result. The work never runs twice.
 * - Handler fails (e.g. insufficient funds): everything rolls back, including the key,
 *   so nothing was processed and the client may retry with the same key.
 */
export class IdempotencyService {
  constructor(private readonly db: DB) {}

  async run<T>(
    request: IdempotentRequest,
    handler: (trx: Trx) => Promise<HandlerResult<T>>,
  ): Promise<IdempotentResponse<T>> {
    const { scope, key } = request;
    const requestHash = hashFingerprint(request.fingerprint);

    return this.db.transaction().execute(async (trx) => {
      const claimed = await trx
        .insertInto('idempotency_keys')
        .values({
          scope,
          key,
          request_hash: requestHash,
          response_status: 0,
          response_body: 'null',
        })
        .onConflict((oc) => oc.columns(['scope', 'key']).doNothing())
        .returning('key')
        .executeTakeFirst();

      if (!claimed) {
        const existing = await trx
          .selectFrom('idempotency_keys')
          .select(['request_hash', 'response_status', 'response_body'])
          .where('scope', '=', scope)
          .where('key', '=', key)
          .executeTakeFirstOrThrow();
        if (existing.request_hash !== requestHash) {
          throw unprocessable(
            'IDEMPOTENCY_KEY_REUSED',
            'This Idempotency-Key was already used for a different request',
          );
        }
        return {
          status: existing.response_status,
          body: existing.response_body as T,
          replayed: true,
        };
      }

      const result = await handler(trx);
      // Return the body as stored, not as built. jsonb re-orders object keys, so this
      // is what makes the first response and every replay byte-for-byte identical.
      const saved = await trx
        .updateTable('idempotency_keys')
        .set({
          response_status: result.status,
          response_body: JSON.stringify(result.body),
          transaction_id: result.transactionId ?? null,
        })
        .where('scope', '=', scope)
        .where('key', '=', key)
        .returning('response_body')
        .executeTakeFirstOrThrow();

      return { status: result.status, body: saved.response_body as T, replayed: false };
    });
  }
}

/** SHA-256 of the fingerprint as JSON with sorted keys, so key order never matters. */
export function hashFingerprint(fingerprint: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(fingerprint)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
