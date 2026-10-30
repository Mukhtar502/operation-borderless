import type { Request, Response } from 'express';
import { badRequest } from '../lib/errors.js';
import type { IdempotentResponse } from '../modules/idempotency/idempotency.service.js';

// Printable ASCII without spaces, 1 to 255 characters. UUIDs are recommended.
const KEY_PATTERN = /^[\x21-\x7E]{1,255}$/;

/** Reads the required Idempotency-Key header used by every money-moving endpoint. */
export function requireIdempotencyKey(req: Request): string {
  const key = req.get('Idempotency-Key');
  if (key === undefined || key === '') {
    throw badRequest(
      'IDEMPOTENCY_KEY_REQUIRED',
      'Send an Idempotency-Key header (a UUID is recommended) so the request is safe to retry',
    );
  }
  if (!KEY_PATTERN.test(key)) {
    throw badRequest(
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency-Key must be 1 to 255 printable characters with no spaces',
    );
  }
  return key;
}

export function sendIdempotent(
  res: Response,
  result: IdempotentResponse<{ data: { id: string } }>,
): void {
  // Like wallet creation: a created transaction says where it can be fetched.
  if (result.status === 201) res.location(`/v1/transactions/${result.body.data.id}`);
  res.status(result.status).set('Idempotent-Replayed', String(result.replayed)).json(result.body);
}
