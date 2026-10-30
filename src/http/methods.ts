import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';

/**
 * Registered after a path's real handlers. A known URL called with the wrong method
 * gets 405 plus an Allow header (as HTTP requires), not a misleading 404.
 */
export function allowOnly(...methods: string[]): RequestHandler {
  const allow = methods.join(', ');
  return (req, res) => {
    res.set('Allow', allow);
    throw new AppError(
      405,
      'METHOD_NOT_ALLOWED',
      `${req.method} is not allowed here; use ${allow}`,
    );
  };
}

/** Rejects request bodies that are not JSON, instead of silently ignoring them. */
export const requireJsonBody: RequestHandler = (req, _res, next) => {
  const hasBody =
    Number(req.headers['content-length'] ?? 0) > 0 ||
    req.headers['transfer-encoding'] !== undefined;
  if (hasBody && !req.is('application/json')) {
    throw new AppError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Send the request body as JSON with the header Content-Type: application/json',
    );
  }
  next();
};
