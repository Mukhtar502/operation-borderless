import type { z } from 'zod';
import { badRequest } from '../lib/errors.js';

/** Where the input came from; names the input when a whole-object check fails. */
export type InputSource = 'body' | 'query' | 'params';

export interface ValidationDetail {
  /** The field that failed, e.g. "amount", or the source ("body") for whole-object checks. */
  path: string;
  message: string;
}

// Short hints for fields whose format is not obvious from their name.
const FORMAT_HINTS: Record<string, string> = {
  amount: 'a decimal string, e.g. "100.50"',
};

/**
 * Parses untrusted input against a schema. Failures become a 400 whose messages are
 * plain English and name the field, e.g. "currency must be one of: cNGN, ...", rather
 * than the validation library's internal wording.
 */
export function validate<T extends z.ZodType>(
  schema: T,
  input: unknown,
  source: InputSource = 'body',
): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  // One message per field: the first problem is the root cause (e.g. a wrong type makes
  // every later check on that field fail too, which would only add noise).
  const seen = new Set<string>();
  const details = result.error.issues
    .flatMap((issue) => describeIssue(issue, input, source))
    .filter(({ path }) => !seen.has(path) && seen.add(path));
  throw badRequest(
    'VALIDATION_ERROR',
    details.length === 1 && details[0]
      ? details[0].message
      : `${details.length} fields are invalid; see details`,
    details,
  );
}

function describeIssue(
  issue: z.core.$ZodIssue,
  input: unknown,
  source: InputSource,
): ValidationDetail[] {
  const path = issue.path.map(String).join('.');
  const field = path || source;
  const detail = (message: string): ValidationDetail[] => [{ path: field, message }];

  switch (issue.code) {
    case 'unrecognized_keys':
      return issue.keys.map((key) => ({
        path: path ? `${path}.${key}` : key,
        message: `${key} is not a recognised field`,
      }));

    case 'invalid_type': {
      if (!path) {
        return detail(
          source === 'body' ? 'Request body must be a JSON object' : `${source} must be an object`,
        );
      }
      if (valueAt(input, issue.path) === undefined) return detail(`${field} is required`);
      const hint = FORMAT_HINTS[lastSegment(issue.path)];
      if (hint) return detail(`${field} must be ${hint}`);
      if (issue.expected === 'int') return detail(`${field} must be a whole number`);
      return detail(`${field} must be ${article(issue.expected)}`);
    }

    case 'invalid_value':
      if (path && valueAt(input, issue.path) === undefined) return detail(`${field} is required`);
      return detail(`${field} must be one of: ${issue.values.map(String).join(', ')}`);

    case 'invalid_format':
      return detail(
        `${field} must be a valid ${issue.format === 'uuid' ? 'UUID' : issue.format.replace('_', ' ')}${
          issue.format === 'email' ? ' address' : ''
        }`,
      );

    case 'too_big':
      return detail(
        issue.origin === 'string'
          ? `${field} must be at most ${String(issue.maximum)} characters`
          : `${field} must be at most ${String(issue.maximum)}`,
      );

    case 'too_small':
      return detail(
        issue.origin === 'string'
          ? `${field} must not be empty`
          : `${field} must be at least ${String(issue.minimum)}`,
      );

    default:
      // Messages written in our own schemas (e.g. refine) are already plain English.
      return detail(issue.message);
  }
}

function valueAt(input: unknown, path: PropertyKey[]): unknown {
  let value = input;
  for (const key of path) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<PropertyKey, unknown>)[key];
  }
  return value;
}

function lastSegment(path: PropertyKey[]): string {
  return String(path.at(-1) ?? '');
}

function article(type: string): string {
  return /^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`;
}
