import type { RequestHandler } from 'express';
import { notFound } from '../lib/errors.js';

/** Last route: nothing matched the URL. */
export const notFoundHandler: RequestHandler = (req) => {
  throw notFound('ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`);
};
