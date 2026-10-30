import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';

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
