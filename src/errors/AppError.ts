/**
 * Application error hierarchy.
 *
 * Services throw these for expected failures. The global error handler in `app.ts`
 * turns any error with `isOperational` into a JSON response using its `statusCode`
 * and `code`; anything else is treated as a bug and returned as a generic 500.
 */

/**
 * Base class for expected (operational) errors.
 *
 * @param message    Client-safe text, returned in the response body.
 * @param statusCode HTTP status to respond with.
 * @param code       Stable machine-readable code for clients (e.g. "NOT_FOUND").
 * @param details    Optional extra data, returned to clients as `errors`.
 */
export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;
  isOperational: boolean;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    details?: unknown,
  ) {
    super(message);

    // Subclass name (e.g. "NotFoundError") rather than "Error", for clearer logs.
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    // Always true for AppError: this flag is what separates expected errors from bugs.
    this.isOperational = true;

    Error.captureStackTrace?.(this, this.constructor);
  }
}

/** 400 BAD_REQUEST: the request is malformed or cannot be processed as sent. */
export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, "BAD_REQUEST", details);
  }
}

/** 422 VALIDATION_ERROR: input failed schema validation; put field issues in `details`. */
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, "VALIDATION_ERROR", details);
  }
}

/** 404 NOT_FOUND: the requested resource or route does not exist. */
export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404, "NOT_FOUND");
  }
}

/** 409 CONFLICT: the request conflicts with current state (e.g. a duplicate). */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "CONFLICT");
  }
}

/** 401 UNAUTHORIZED: credentials or token are missing, invalid or no longer allowed. */
export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED");
  }
}

/** 403 FORBIDDEN: the caller is identified but lacks permission. */
export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, 403, "FORBIDDEN");
  }
}

/** 401 AUTHENTICATION_FAILED: a login attempt failed (distinct code from UNAUTHORIZED). */
export class AuthenticationError extends AppError {
  constructor(message = "Authentication Failed") {
    super(message, 401, "AUTHENTICATION_FAILED");
  }
}
