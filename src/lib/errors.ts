// Every error the API returns on purpose is an AppError. Anything else reaching
// the error handler is a bug and is reported as a generic 500.
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details);

export const notFound = (code: string, message: string) => new AppError(404, code, message);

export const conflict = (code: string, message: string) => new AppError(409, code, message);

export const unprocessable = (code: string, message: string, details?: unknown) =>
  new AppError(422, code, message, details);
