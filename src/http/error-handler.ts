import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError, notFound } from '../lib/errors.js';

export const notFoundHandler: RequestHandler = (req) => {
  throw notFound('ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`);
};

// Single place that shapes error responses:
// { "error": { "code", "message", "details"?, "requestId" } }
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  let error: AppError;
  if (err instanceof AppError) {
    error = err;
  } else if (isBodyParserError(err)) {
    error =
      err.type === 'entity.too.large'
        ? new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large')
        : new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  } else {
    req.log.error({ err }, 'unhandled error');
    error = new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }

  res.status(error.status).json({
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
      requestId: req.id,
    },
  });
};

function isBodyParserError(err: unknown): err is { type: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    typeof err.type === 'string' &&
    err.type.startsWith('entity.')
  );
}
