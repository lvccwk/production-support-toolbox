/**
 * Shared error taxonomy (Engineering Review §9).
 *
 * Two layers:
 *   - `ToolError`: user-facing validation errors raised by PURE logic (routes
 *     and repositories). Messages are crafted by our own code and are safe to
 *     show, but may still be truncated before leaving the server.
 *   - `ApiError`: HTTP-tagged errors produced at the API boundary (auth,
 *     not-found, payload-too-large, …). The client sees ONLY the stable
 *     `code`, a `message` and a `requestId` — never raw internal errors,
 *     SQLite paths, upstream bodies or credentials.
 */

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/** Small helper for user-facing validation errors raised by pure logic. */
export class ToolError extends Error {
  readonly code: string;

  constructor(message: string, code = "INPUT_ERROR") {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}

/** HTTP-tagged API error: the only error type whose message is client-safe. */
export class ApiError extends Error {
  readonly code: ErrorCode;

  constructor(message: string, code: ErrorCode = "VALIDATION_ERROR") {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }

  /** HTTP status derived from the stable code. */
  get status(): number {
    return ERROR_STATUS[this.code];
  }

  static unauthenticated(message = "Missing or invalid bearer token."): ApiError {
    return new ApiError(message, "UNAUTHENTICATED");
  }

  static forbidden(message = "Insufficient scope for this operation."): ApiError {
    return new ApiError(message, "FORBIDDEN");
  }

  static notFound(message = "Resource not found."): ApiError {
    return new ApiError(message, "NOT_FOUND");
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Wrap an unknown thrown value into a ToolError (keeps messages stable). */
export function toToolError(error: unknown): ToolError {
  if (error instanceof ToolError) return error;
  if (error instanceof Error) return new ToolError(error.message);
  return new ToolError(String(error));
}

const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  400: "VALIDATION_ERROR",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  429: "RATE_LIMITED",
  503: "SERVICE_UNAVAILABLE",
  500: "INTERNAL_ERROR",
};

export interface SanitizedError {
  code: ErrorCode;
  message: string;
  requestId: string;
  status: number;
}

export interface SanitizeOptions {
  /** Explicit HTTP status hint from the caller (e.g. 404 for a ToolError). */
  status?: number;
  /** Explicit code override (takes precedence over the status map). */
  code?: ErrorCode;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/**
 * Convert any thrown value into a client-safe, sanitized error.
 *
 * - `ApiError` and `ToolError` are OUR messages (actionable, no secrets).
 * - Anything else (SQLite, filesystem, upstream, bugs) becomes a generic
 *   `INTERNAL_ERROR` 500 — the real detail only goes to the server log via
 *   the caller's logging path, never to the client.
 */
export function sanitizeError(
  error: unknown,
  requestId: string,
  opts: SanitizeOptions = {},
): SanitizedError {
  if (error instanceof ApiError) {
    return {
      code: error.code,
      message: error.message,
      requestId,
      status: error.status,
    };
  }
  if (error instanceof ToolError) {
    const status = opts.status ?? 400;
    const code = opts.code ?? STATUS_TO_CODE[status] ?? "VALIDATION_ERROR";
    return {
      code,
      message: truncate(error.message, 300),
      requestId,
      status,
    };
  }
  void opts;
  return {
    code: "INTERNAL_ERROR",
    message: "Internal server error.",
    requestId,
    status: 500,
  };
}

/** Rough class label for server-side logging (never sent to the client). */
export function errorClassName(error: unknown): string {
  if (error instanceof ApiError) return `ApiError:${error.code}`;
  if (error instanceof ToolError) return "ToolError";
  if (error instanceof Error) return error.name || "Error";
  return typeof error;
}