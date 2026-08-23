import { describe, expect, it } from "vitest";
import {
  bearerToken,
  checkBearer,
  requireApiAccess,
  resolveAuthConfig,
  type AuthConfig,
} from "./auth";

/** Minimal structural NextRequest fake (routes only touch these members). */
function req(
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) {
  return {
    nextUrl: new URL(url),
    method: init?.method ?? "GET",
    headers: new Headers(init?.headers ?? {}),
  } as unknown as Parameters<typeof requireApiAccess>[0];
}

const TOKENS = {
  admin: "admin-secret-0123456789abcdef",
  write: "write-secret-0123456789abcdef",
  read: "read-secret-0123456789abcdef",
};

function cfg(env: Record<string, string | undefined>): AuthConfig {
  return resolveAuthConfig(env as unknown as NodeJS.ProcessEnv);
}

describe("resolveAuthConfig", () => {
  it("is off by default (local, loopback-bound)", () => {
    const config = cfg({});
    expect(config.enforced).toBe(false);
    expect(config.remote).toBe(false);
    expect(config.tokens).toEqual([]);
  });

  it("maps tokens to scopes and flips enforcement on", () => {
    const config = cfg({
      PST_API_TOKEN: TOKENS.admin,
      PST_API_TOKEN_WRITE: TOKENS.write,
      PST_API_TOKEN_READ: TOKENS.read,
    });
    expect(config.enforced).toBe(true);
    expect(config.tokens.map((t) => t.scope)).toEqual(["admin", "write", "read"]);
  });

  it("remote mode without tokens is enforced but credential-less (fail closed)", () => {
    const config = cfg({ PST_REMOTE_ACCESS: "true" });
    expect(config.enforced).toBe(true);
    expect(config.remote).toBe(true);
    expect(config.tokens).toEqual([]);
  });
});

describe("checkBearer — scope model + constant-time comparison", () => {
  it("grants a token its own scope and everything below it", () => {
    const config = cfg({ PST_API_TOKEN: TOKENS.admin });
    expect(checkBearer(TOKENS.admin, "admin", config)).toEqual({ ok: true, scope: "admin" });
    expect(checkBearer(TOKENS.admin, "write", config)).toEqual({ ok: true, scope: "admin" });
    expect(checkBearer(TOKENS.admin, "read", config)).toEqual({ ok: true, scope: "admin" });
  });

  it("write token cannot access admin", () => {
    const config = cfg({ PST_API_TOKEN_WRITE: TOKENS.write });
    expect(checkBearer(TOKENS.write, "write", config)).toEqual({ ok: true, scope: "write" });
    expect(checkBearer(TOKENS.write, "admin", config)).toEqual({
      ok: false,
      reason: "FORBIDDEN",
      scope: "write",
    });
  });

  it("read token cannot access write or admin", () => {
    const config = cfg({ PST_API_TOKEN_READ: TOKENS.read });
    expect(checkBearer(TOKENS.read, "read", config)).toEqual({ ok: true, scope: "read" });
    expect(checkBearer(TOKENS.read, "write", config)).toEqual({
      ok: false,
      reason: "FORBIDDEN",
      scope: "read",
    });
    expect(checkBearer(TOKENS.read, "admin", config)).toEqual({
      ok: false,
      reason: "FORBIDDEN",
      scope: "read",
    });
  });

  it("rejects unknown tokens", () => {
    const config = cfg({ PST_API_TOKEN: TOKENS.admin });
    expect(checkBearer("wrong-secret-0123456789abcdef", "read", config)).toEqual({
      ok: false,
      reason: "UNAUTHENTICATED",
    });
  });

  it("never accepts the token via query strings (only the header is read)", () => {
    const request = req("http://localhost/api?token=" + TOKENS.admin, {
      headers: { Authorization: `Bearer ${TOKENS.admin}` },
    });
    expect(bearerToken(request)).toBe(TOKENS.admin);
  });
});

describe("requireApiAccess — route-level guard", () => {
  it("allows everything when auth is not enforced (local mode)", () => {
    const config = cfg({});
    expect(requireApiAccess(req("http://localhost/api/incidents"), "admin", config)).toBeNull();
  });

  it("fails closed with 503 when remote mode has no credential configured", () => {
    const config = cfg({ PST_REMOTE_ACCESS: "true" });
    const denied = requireApiAccess(req("http://localhost/api/export"), "admin", config);
    expect(denied?.code).toBe("SERVICE_UNAVAILABLE");
    expect(denied?.status).toBe(503);
  });

  it("returns UNAUTHENTICATED for a missing or malformed header", () => {
    const config = cfg({ PST_API_TOKEN: TOKENS.admin });
    const none = requireApiAccess(req("http://localhost/api/incidents"), "read", config);
    expect(none?.code).toBe("UNAUTHENTICATED");
    const malformed = requireApiAccess(
      req("http://localhost/api/incidents", { headers: { Authorization: "Basic abc" } }),
      "read",
      config,
    );
    expect(malformed?.code).toBe("UNAUTHENTICATED");
  });

  it("returns UNAUTHENTICATED for a wrong token", () => {
    const config = cfg({ PST_API_TOKEN: TOKENS.admin });
    const denied = requireApiAccess(
      req("http://localhost/api/incidents", { headers: { Authorization: "Bearer nope-0123456789" } }),
      "read",
      config,
    );
    expect(denied?.code).toBe("UNAUTHENTICATED");
    expect(denied?.status).toBe(401);
  });

  it("returns FORBIDDEN for a valid token with insufficient scope", () => {
    const config = cfg({ PST_API_TOKEN_READ: TOKENS.read });
    const denied = requireApiAccess(
      req("http://localhost/api/import", { headers: { Authorization: `Bearer ${TOKENS.read}` } }),
      "admin",
      config,
    );
    expect(denied?.code).toBe("FORBIDDEN");
    expect(denied?.status).toBe(403);
  });

  it("allows a valid token with sufficient scope", () => {
    const config = cfg({ PST_API_TOKEN: TOKENS.admin });
    expect(
      requireApiAccess(
        req("http://localhost/api/export", { headers: { Authorization: `Bearer ${TOKENS.admin}` } }),
        "admin",
        config,
      ),
    ).toBeNull();
  });

  it("rejects cross-origin browser writes (CSRF) while allowing same-origin", () => {
    const config = cfg({ PST_API_TOKEN: TOKENS.admin });
    const crossOrigin = requireApiAccess(
      req("http://localhost/api/history", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKENS.admin}`,
          Origin: "https://evil.example.com",
        },
      }),
      "write",
      config,
    );
    expect(crossOrigin?.code).toBe("FORBIDDEN");
    expect(crossOrigin?.message).toContain("origin");

    const sameOrigin = requireApiAccess(
      req("http://localhost/api/history", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKENS.admin}`,
          Origin: "http://localhost:3000",
          Host: "localhost:3000",
        },
      }),
      "write",
      config,
    );
    expect(sameOrigin).toBeNull();
  });

  it("allows agent-style writes without an Origin header (non-browser)", () => {
    const config = cfg({ PST_API_TOKEN: TOKENS.admin });
    expect(
      requireApiAccess(
        req("http://localhost/api/history", {
          method: "POST",
          headers: { Authorization: `Bearer ${TOKENS.admin}` },
        }),
        "write",
        config,
      ),
    ).toBeNull();
  });

  it("does not enforce CSRF for GET requests", () => {
    const config = cfg({ PST_API_TOKEN: TOKENS.admin });
    expect(
      requireApiAccess(
        req("http://localhost/api/history", {
          headers: { Authorization: `Bearer ${TOKENS.admin}`, Origin: "https://evil.example.com" },
        }),
        "read",
        config,
      ),
    ).toBeNull();
  });
});