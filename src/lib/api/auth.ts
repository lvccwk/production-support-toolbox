import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/errors";

/**
 * Centralized API access control (Engineering Review §3, P0).
 *
 * Modes:
 *   - default (local): nothing enforced — the dev/start scripts bind to
 *     127.0.0.1, so only loopback can reach the service.
 *   - remote (PST_REMOTE_ACCESS=true): enforcement ON. Any of
 *     PST_API_TOKEN (admin), PST_API_TOKEN_WRITE (read+write) or
 *     PST_API_TOKEN_READ (read) may be configured. If none is configured the
 *     service fails closed: every protected route returns 503.
 *   - token configured without remote mode: enforcement is also ON
 *     (defense in depth if the service is ever exposed via a proxy).
 *
 * Rules:
 *   - `Authorization: Bearer <token>` only — query-string tokens are rejected.
 *   - Constant-time comparison (both sides SHA-256 hashed first so the
 *     buffers have equal length).
 *   - Scopes: read < write < admin; a token grants its scope AND everything
 *     below it (admin ⊇ write ⊇ read).
 *   - Tokens never appear in responses, logs, history or exports.
 */

export type Scope = "read" | "write" | "admin";

const SCOPE_RANK: Record<Scope, number> = { read: 1, write: 2, admin: 3 };

export interface TokenEntry {
  secret: string;
  scope: Scope;
}

export interface AuthConfig {
  /** Whether any API requires a token (remote mode OR a token is configured). */
  enforced: boolean;
  /** PST_REMOTE_ACCESS=true — service is intentionally reachable off-host. */
  remote: boolean;
  tokens: TokenEntry[];
}

export function resolveAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const remote = env.PST_REMOTE_ACCESS === "true";
  const tokens: TokenEntry[] = [];
  if (env.PST_API_TOKEN) tokens.push({ secret: env.PST_API_TOKEN, scope: "admin" });
  if (env.PST_API_TOKEN_WRITE) tokens.push({ secret: env.PST_API_TOKEN_WRITE, scope: "write" });
  if (env.PST_API_TOKEN_READ) tokens.push({ secret: env.PST_API_TOKEN_READ, scope: "read" });
  return { enforced: remote || tokens.length > 0, remote, tokens };
}

function digest(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}

/** Constant-time equality over SHA-256 digests (equal-length buffers). */
function tokensEqual(a: string, b: string): boolean {
  const ah = digest(a);
  const bh = digest(b);
  return timingSafeEqual(ah, bh);
}

export type TokenCheckResult =
  | { ok: true; scope: Scope }
  | { ok: false; reason: "UNAUTHENTICATED" | "FORBIDDEN"; scope?: Scope };

/**
 * Check a raw bearer token against every configured token. Tokens grant their
 * own scope and everything below it.
 */
export function checkBearer(
  token: string,
  required: Scope,
  config: AuthConfig,
): TokenCheckResult {
  for (const entry of config.tokens) {
    if (tokensEqual(token, entry.secret)) {
      if (SCOPE_RANK[entry.scope] >= SCOPE_RANK[required]) {
        return { ok: true, scope: entry.scope };
      }
      return { ok: false, reason: "FORBIDDEN", scope: entry.scope };
    }
  }
  return { ok: false, reason: "UNAUTHENTICATED" };
}

/** Extract the bearer token from a request; query strings are ignored. */
export function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/** Allowed origins for browser write requests (CSRF defense). */
function originAllowed(origin: string, request: NextRequest): boolean {
  // Same-origin requests (the GUI itself) are always allowed.
  const host = request.headers.get("host");
  if (host) {
    try {
      const hostUrl = new URL(`http://${host}`);
      const originUrl = new URL(origin);
      if (originUrl.host === hostUrl.host) return true;
    } catch {
      return false;
    }
  }
  const allowList = (process.env.PST_ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const glob = (pattern: string, value: string): boolean => {
    // Wildcards match one dot-separated label (next.config.ts convention).
    const parts = pattern.split(".");
    const given = value.split(".");
    if (parts.length !== given.length) return false;
    return parts.every((part, i) => part === "*" || part === given[i]);
  };
  return allowList.some((pattern) => glob(pattern, origin));
}

/**
 * Enforce access for one route. Returns null when the request may proceed,
 * otherwise an ApiError to render via apiErrorResponse.
 *
 * @param required scope needed by this route
 * @param config resolved auth config (resolveAuthConfig)
 * @param method OPTIONAL — pass "GET" to skip the CSRF check (reads are safe).
 */
export function requireApiAccess(
  request: NextRequest,
  required: Scope,
  config: AuthConfig,
): ApiError | null {
  if (!config.enforced) return null;

  // Fail closed: remote mode without any configured credential.
  if (config.tokens.length === 0) {
    return new ApiError(
      "Remote access requires a token: set PST_API_TOKEN (admin) or PST_API_TOKEN_WRITE / PST_API_TOKEN_READ before starting.",
      "SERVICE_UNAVAILABLE",
    );
  }

  const token = bearerToken(request);
  if (!token) {
    return ApiError.unauthenticated("Missing bearer token (Authorization: Bearer <token>).");
  }

  const checked = checkBearer(token, required, config);
  if (!checked.ok) {
    return checked.reason === "FORBIDDEN"
      ? ApiError.forbidden(
          `Insufficient scope: this endpoint requires "${required}" (token has "${checked.scope}").`,
        )
      : ApiError.unauthenticated("Invalid or expired token.");
  }

  // CSRF defense for browser-originated writes: a cross-origin origin must be
  // explicitly allowed. Non-browser callers (agents) send no Origin header.
  const method = request.method ?? "GET";
  const origin = request.headers.get("origin");
  if (method !== "GET" && origin && !originAllowed(origin, request)) {
    return ApiError.forbidden("Cross-origin request rejected (origin not allowed).");
  }
  return null;
}