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
