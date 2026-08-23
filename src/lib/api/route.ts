import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { apiErrorResponse, apiOk, newRequestId, type ResponseMeta } from "./http";
import { requireApiAccess, resolveAuthConfig, type Scope } from "./auth";
import { logApiEvent } from "./logger";

/**
 * Unified API route wrapper (Engineering Review §3 + §9).
 *
 * Every /api route handler is wrapped in `withApi` so authentication (when
 * enforced), request-ID generation, duration measurement and structured
 * logging happen in ONE place instead of being duplicated per route:
 *
 *   export async function GET(request: NextRequest) {
 *     return withApi(request, { route: "/api/incidents", scope: "read" }, async () => {
 *       return { incidents: listIncidents() };
 *     });
 *   }
 *
 * - `scope` is optional: omit for endpoints that expose no user data
 *   (the pure stateless tool endpoints stay open; read/write/admin apply
 *   to the data APIs).
 * - The handler may `throw` ToolError (400) / ApiError (401/403/404/…) —
 *   the wrapper sanitizes and logs.
 * - Returning a value produces `{ ok: true, data }`; returning a
 *   NextResponse passes it through (CSV downloads, custom status codes).
 */

export interface WithApiOptions {
  route: string;
  scope?: Scope;
}

export function withApi<T>(
  request: NextRequest,
  opts: WithApiOptions,
  handler: (requestId: string) => T | Promise<T>,
): Promise<NextResponse> {
  const requestId = newRequestId();
  const started = Date.now();
  const meta: ResponseMeta = {
    requestId,
    route: opts.route,
    method: request.method ?? "GET",
  };

  return (async () => {
    try {
      if (opts.scope) {
        const denied = requireApiAccess(request, opts.scope, resolveAuthConfig());
        if (denied) return apiErrorResponse(denied, { ...meta, durationMs: Date.now() - started });
      }
      const result = await handler(requestId);
      if (result instanceof NextResponse) {
        logApiEvent({
          event: "api",
          level: "info",
          ...meta,
          status: result.status,
          durationMs: Date.now() - started,
        });
        return result;
      }
      return apiOk(result, { ...meta, durationMs: Date.now() - started });
    } catch (error) {
      return apiErrorResponse(error, { ...meta, durationMs: Date.now() - started });
    }
  })();
}