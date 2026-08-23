import { describe, expect, it } from "vitest";
import { ApiError, ToolError, sanitizeError } from "@/lib/errors";
import { apiErrorResponse, guardBodySize, newRequestId } from "./http";

/** Minimal structural NextRequest fake. */
function req(url: string, init?: { method?: string; headers?: Record<string, string> }) {
  return {
    nextUrl: new URL(url),
    method: init?.method ?? "GET",
    headers: new Headers(init?.headers ?? {}),
  } as unknown as Parameters<typeof guardBodySize>[0];
}

describe("sanitizeError — taxonomy mapping (§9)", () => {
  it("maps ApiError to its own stable code/status/message", () => {
    const out = sanitizeError(ApiError.notFound("History entry not found."), "r1");
    expect(out).toMatchObject({
      code: "NOT_FOUND",
      status: 404,
      message: "History entry not found.",
      requestId: "r1",
    });
  });

  it("maps ToolError to VALIDATION_ERROR 400 by default", () => {
    const out = sanitizeError(new ToolError("Summary is required."), "r2");
    expect(out).toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
  });

  it("honours an explicit status hint (e.g. 404) for ToolError", () => {
    const out = sanitizeError(new ToolError("Rule not found."), "r3", { status: 404 });
    expect(out).toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("turns unknown errors into a GENERIC 500 — no internals ever reach the client", () => {
    const secret = "EACCES: permission denied, open 'C:\\Users\\me\\.ssh\\id_rsa'";
    const out = sanitizeError(new Error(secret), "r4");
    expect(out.code).toBe("INTERNAL_ERROR");
    expect(out.status).toBe(500);
    expect(out.message).toBe("Internal server error.");
    expect(out.message).not.toContain("EACCES");
    expect(out.message).not.toContain("id_rsa");
  });

  it("redacts SQLite paths thrown as plain errors", () => {
    const out = sanitizeError(new Error("SQLITE_ERROR: no such table: data/app.db"), "r5");
    expect(out.message).not.toContain("app.db");
    expect(out.message).toBe("Internal server error.");
  });

  it("truncates long ToolError messages but keeps them actionable", () => {
    const long = new ToolError(`Invalid pattern #1: ${"x".repeat(500)}`);
    const out = sanitizeError(long, "r6");
    expect(out.message.length).toBeLessThan(400);
  });
});

describe("apiErrorResponse — client-facing shape", () => {
  it("returns { ok:false, error:{code,message,requestId}, message } with the right status", async () => {
    const response = apiErrorResponse(new ToolError("Summary is required."), {
      requestId: "req-123",
      route: "/api/history",
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      ok: boolean;
      error: { code: string; message: string; requestId: string };
      message: string;
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Summary is required.");
    expect(body.error.requestId).toBe("req-123");
    expect(body.message).toBe(body.error.message);
  });

  it("never includes the raw message of unknown errors", async () => {
    const response = apiErrorResponse(new Error("connection string postgres://user:pass@db"), {
      requestId: "req-9",
    });
    const body = (await response.json()) as { error: { message: string } };
    expect(response.status).toBe(500);
    expect(body.error.message).toBe("Internal server error.");
  });

  it("generates unique request ids", () => {
    expect(newRequestId()).not.toBe(newRequestId());
    expect(newRequestId().length).toBeGreaterThan(20);
  });
});

describe("guardBodySize", () => {
  it("allows requests within the cap", () => {
    expect(guardBodySize(req("http://localhost/api/x", { headers: { "Content-Length": "100" } }))).toBeNull();
  });

  it("rejects oversized bodies before parsing with PAYLOAD_TOO_LARGE", () => {
    const denied = guardBodySize(
      req("http://localhost/api/x", { headers: { "Content-Length": "99999999" } }),
    );
    expect(denied?.code).toBe("PAYLOAD_TOO_LARGE");
    expect(denied?.status).toBe(413);
  });

  it("applies a custom cap when given", () => {
    const denied = guardBodySize(
      req("http://localhost/api/x", { headers: { "Content-Length": "2000" } }),
      1024,
    );
    expect(denied).not.toBeNull();
  });
});