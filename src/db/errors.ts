import { DatabaseError } from 'pg';

/** True when Postgres rejected a write because of a UNIQUE constraint (SQLSTATE 23505). */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  return (
    err instanceof DatabaseError &&
    err.code === '23505' &&
    (constraint === undefined || err.constraint === constraint)
  );
}
