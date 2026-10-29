import type { z } from 'zod';
import { badRequest } from '../lib/errors.js';

// Parses untrusted input against a schema, turning Zod issues into a 400 that
// tells the client exactly which field was wrong.
export function validate<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw badRequest(
      'VALIDATION_ERROR',
      'Request validation failed',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}
