import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ApiError,
  sanitizeError,
  errorClassName,
  type ErrorCode,
  type SanitizedError,
} from "@/lib/errors";
import { logApiEvent } from "./logger";

/**
 * Shared API response helpers (Engineering Review §9). Every /api route
 * responds through these so the error shape, status mapping and request
 * logging stay consistent:
 *
 *   success: { ok: true, data }
 *   failure: { ok: false, error: { code, message, requestId }, message }
 *
 * The client NEVER receives raw internal error messages; use `ApiError` /
 * `ToolError` for messages that are safe to show, or pass an explicit
 * `status` hint so the mapper derives the right stable code.
 */

export function newRequestId(): string {
  return randomUUID();
}

export interface ResponseMeta {
  requestId: string;
  route?: string;
  method?: string;
  /** Milliseconds the handler took (measured by the route). */
  durationMs?: number;
}

export interface ErrorResponseMeta extends ResponseMeta {
  /** HTTP status hint for ToolError mapping (e.g. 404 for "not found"). */
  status?: number;
  /** Explicit stable code override. */
  code?: ErrorCode;
}

export function apiErrorResponse(error: unknown, meta: ErrorResponseMeta): NextResponse {
  const sanitized: SanitizedError = sanitizeError(error, meta.requestId, {
    status: meta.status,
    code: meta.code,
  });
  logApiEvent({
    event: "api",
    level: sanitized.status >= 500 ? "error" : "info",
    requestId: sanitized.requestId,
    route: meta.route,
    method: meta.method,
    status: sanitized.status,
    durationMs: meta.durationMs,
    errorClass: errorClassName(error),
  });
  return NextResponse.json(
    { ok: false, error: sanitized, message: sanitized.message },
    { status: sanitized.status },
  );
}

export function apiOk(data: unknown, meta: ResponseMeta, status = 200): NextResponse {
  logApiEvent({
    event: "api",
    level: "info",
    requestId: meta.requestId,
    route: meta.route,
    method: meta.method,
    status,
    durationMs: meta.durationMs,
  });
  return NextResponse.json({ ok: true, data }, { status });
}

/** Default JSON body cap for POST/PUT endpoints (2 MB, generous for backups). */
export const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Reject oversized bodies BEFORE JSON.parse using the Content-Length header
 * (the plan's "limit bytes before parsing" requirement). Returns null when
 * the request may proceed.
 */
export function guardBodySize(
  request: NextRequest,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): ApiError | null {
  const header = request.headers.get("content-length");
  if (header) {
    const length = Number(header);
    if (Number.isFinite(length) && length > maxBytes) {
      return new ApiError(
        `Request body too large (max ${maxBytes} bytes).`,
        "PAYLOAD_TOO_LARGE",
      );
    }
  }
  return null;
}