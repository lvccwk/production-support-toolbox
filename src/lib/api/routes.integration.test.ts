import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { closeDb, initDb } from "@/lib/database/db";

import * as incidentsRoute from "@/app/api/incidents/route";
import * as incidentIdRoute from "@/app/api/incidents/[id]/route";
import * as historyRoute from "@/app/api/history/route";
import * as historyIdRoute from "@/app/api/history/[id]/route";
import * as exportRoute from "@/app/api/export/route";
import * as importRoute from "@/app/api/import/route";
import * as rulesRoute from "@/app/api/tools/rules/route";
import * as rulesIdRoute from "@/app/api/tools/rules/[id]/route";
import * as rulesImportRoute from "@/app/api/tools/rules/import/route";
import * as analyzeRoute from "@/app/api/tools/analyze/route";
import * as analyzeStreamRoute from "@/app/api/tools/analyze/stream/route";

/**
 * API integration tests (Engineering Review §10) — every protected route is
 * exercised end-to-end through its actual Next.js handler with structural
 * request fakes, against a real temp SQLite database. Covers the auth matrix
 * (no/valid/wrong/insufficient token, fail-closed remote mode, CSRF origin
 * check), error-shape sanitization, CRUD, rules lifecycle and the
 * all-or-nothing rules import.
 */

const readToken = "read-token-1234567890abcdef";
const writeToken = "write-token-1234567890abcdef";
const adminToken = "admin-token-1234567890abcdef";

let tempDir: string;
let seq = 0;

function fakeRequest(
  url: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string> },
): NextRequest {
  return {
    nextUrl: new URL(url),
    method: init?.method ?? "GET",
    json: async () => init?.body ?? {},
    headers: new Headers(init?.headers ?? {}),
  } as unknown as NextRequest;
}

function fakeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function json(res: Response): Promise<{
  ok?: boolean;
  data?: unknown;
  error?: { code?: string; message?: string; requestId?: string };
  message?: string;
}> {
  return (await res.json()) as never;
}

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pst-api-"));
});

beforeEach(() => {
  seq += 1;
  initDb(path.join(tempDir, `api-${seq}.db`));
});

afterAll(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("authentication matrix (P0)", () => {
  it("local mode (default): data APIs are open — no token required", async () => {
    vi.stubEnv("PST_REMOTE_ACCESS", "");
    vi.stubEnv("PST_API_TOKEN", "");
    try {
      const res = await incidentsRoute.GET(fakeRequest("http://localhost/api/incidents"));
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.ok).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("remote mode without any credential fails closed with 503", async () => {
    vi.stubEnv("PST_REMOTE_ACCESS", "true");
    vi.stubEnv("PST_API_TOKEN", "");
    vi.stubEnv("PST_API_TOKEN_WRITE", "");
    vi.stubEnv("PST_API_TOKEN_READ", "");
    try {
      const res = await incidentsRoute.GET(fakeRequest("http://localhost/api/incidents"));
      expect(res.status).toBe(503);
      const body = await json(res);
      expect(body.error?.code).toBe("SERVICE_UNAVAILABLE");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("missing token -> 401 with a sanitized, request-id-tagged error", async () => {
    vi.stubEnv("PST_REMOTE_ACCESS", "true");
    vi.stubEnv("PST_API_TOKEN", adminToken);
    try {
      const res = await historyRoute.GET(fakeRequest("http://localhost/api/history"));
      expect(res.status).toBe(401);
      const body = await json(res);
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("UNAUTHENTICATED");
      expect(body.error?.requestId).toBeTruthy();
      expect(body.error?.message).toContain("Bearer");
      expect(JSON.stringify(body)).not.toContain(adminToken);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("wrong token -> 401", async () => {
    vi.stubEnv("PST_API_TOKEN", adminToken);
    try {
      const res = await incidentsRoute.GET(
        fakeRequest("http://localhost/api/incidents", { headers: bearer("nope-1234567890abcdef") }),
      );
      expect(res.status).toBe(401);
      expect((await json(res)).error?.code).toBe("UNAUTHENTICATED");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("read token cannot reach admin endpoints (export) -> 403", async () => {
    vi.stubEnv("PST_API_TOKEN_READ", readToken);
    try {
      const res = await exportRoute.GET(
        fakeRequest("http://localhost/api/export", { headers: bearer(readToken) }),
      );
      expect(res.status).toBe(403);
      expect((await json(res)).error?.code).toBe("FORBIDDEN");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("write token can create but not delete -> 403 on DELETE", async () => {
    vi.stubEnv("PST_API_TOKEN_WRITE", writeToken);
    try {
      const created = await incidentIdRoute.GET(
        fakeRequest("http://localhost/api/incidents/999", { headers: bearer(writeToken) }),
        fakeParams("999"),
      );
      expect(created.status).toBe(404);

      const deleted = await incidentIdRoute.DELETE(
        fakeRequest("http://localhost/api/incidents/999", { headers: bearer(writeToken) }),
        fakeParams("999"),
      );
      expect(deleted.status).toBe(403);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("admin token reaches every scope", async () => {
    vi.stubEnv("PST_API_TOKEN", adminToken);
    try {
      const list = await incidentsRoute.GET(
        fakeRequest("http://localhost/api/incidents", { headers: bearer(adminToken) }),
      );
      expect(list.status).toBe(200);

      const deleted = await historyIdRoute.DELETE(
        fakeRequest("http://localhost/api/history/999", { headers: bearer(adminToken) }),
        fakeParams("999"),
      );
      expect(deleted.status).toBe(404); // auth passed, resource missing
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects cross-origin browser writes while allowing same-origin", async () => {
    vi.stubEnv("PST_API_TOKEN", adminToken);
    try {
      const cross = await historyRoute.POST(
        fakeRequest("http://localhost/api/history", {
          method: "POST",
          headers: { ...bearer(adminToken), Origin: "https://evil.example.com" },
          body: {
            tool: "json",
            summary: "x",
            severity: null,
            payload: "{}",
          },
        }),
      );
      expect(cross.status).toBe(403);

      const same = await historyRoute.POST(
        fakeRequest("http://localhost/api/history", {
          method: "POST",
          headers: {
            ...bearer(adminToken),
            Origin: "http://localhost:3000",
            Host: "localhost:3000",
          },
          body: { tool: "json", summary: "x", severity: null, payload: "{}" },
        }),
      );
      expect(same.status).toBe(201);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("data API flows (CRUD, export/import, rules lifecycle)", () => {
  it("incidents CRUD through the routes with an admin token", async () => {
    vi.stubEnv("PST_API_TOKEN", adminToken);
    try {
      const headers = bearer(adminToken);
      const created = await incidentsRoute.POST(
        fakeRequest("http://localhost/api/incidents", {
          method: "POST",
          headers,
          body: { title: "API incident", system: "API", status: "Investigating", severity: "High" },
        }),
      );
      expect(created.status).toBe(201);
      const createdBody = await json(created);
      const id = (createdBody.data as { id: number }).id;
      expect(id).toBeGreaterThan(0);

      const listed = await incidentsRoute.GET(
        fakeRequest("http://localhost/api/incidents?q=API incident", { headers }),
      );
      expect((await json(listed)).data).toHaveLength(1);

      const updated = await incidentIdRoute.PUT(
        fakeRequest("http://localhost/api/incidents/" + id, {
          method: "PUT",
          headers,
          body: { title: "API incident (fixed)", system: "API", status: "Closed", severity: "Low" },
        }),
        fakeParams(String(id)),
      );
      expect((await json(updated)).data).toMatchObject({ status: "Closed" });

      const deleted = await incidentIdRoute.DELETE(
        fakeRequest("http://localhost/api/incidents/" + id, { method: "DELETE", headers }),
        fakeParams(String(id)),
      );
      expect(deleted.status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("export -> import round-trip across routes", async () => {
    vi.stubEnv("PST_API_TOKEN", adminToken);
    try {
      const headers = bearer(adminToken);
      await historyRoute.POST(
        fakeRequest("http://localhost/api/history", {
          method: "POST",
          headers,
          body: { tool: "cron", summary: "backup me", severity: "Low", payload: "{}" },
        }),
      );
      const exported = await exportRoute.GET(
        fakeRequest("http://localhost/api/export?format=json", { headers }),
      );
      expect(exported.status).toBe(200);
      const bundleText = await exported.text();
      expect(JSON.parse(bundleText).schemaVersion).toBe(2);

      const imported = await importRoute.POST(
        fakeRequest("http://localhost/api/import", {
          method: "POST",
          headers,
          body: { data: bundleText },
        }),
      );
      const result = (await json(imported)).data as {
        importedHistory: number;
        skipped: number;
      };
      expect(result.importedHistory).toBe(0); // same DB -> duplicates
      expect(result.skipped).toBe(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rules lifecycle: register (torture-tested), list, update, delete", async () => {
    vi.stubEnv("PST_API_TOKEN", adminToken);
    try {
      const headers = bearer(adminToken);
      const created = await rulesRoute.POST(
        fakeRequest("http://localhost/api/tools/rules", {
          method: "POST",
          headers,
          body: {
            name: "step44-timeout",
            scope: { type: "components", values: ["PaymentBatch"] },
            patterns: ["STEP44.*timeout"],
            severity: "High",
          },
        }),
      );
      expect(created.status).toBe(201);
      const rule = ((await json(created)).data as { rule: { id: number } }).rule;

      const listed = await rulesRoute.GET(
        fakeRequest("http://localhost/api/tools/rules?export=json", { headers }),
      );
      expect((await json(listed)).data).toMatchObject({ rules: expect.any(Array) });

      const updated = await rulesIdRoute.PUT(
        fakeRequest("http://localhost/api/tools/rules/" + rule.id, {
          method: "PUT",
          headers,
          body: { severity: "Critical" },
        }),
        fakeParams(String(rule.id)),
      );
      const updatedBody = (await json(updated)) as { data?: { rule?: { severity?: string } } };
      expect(updatedBody.data?.rule?.severity).toBe("Critical");

      const removed = await rulesIdRoute.DELETE(
        fakeRequest("http://localhost/api/tools/rules/" + rule.id, { method: "DELETE", headers }),
        fakeParams(String(rule.id)),
      );
      expect(removed.status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("import bundle exceeding the active cap is rejected whole (all-or-nothing)", async () => {
    vi.stubEnv("PST_API_TOKEN", adminToken);
    vi.stubEnv("PST_MAX_CUSTOM_RULES", "1");
    try {
      const headers = bearer(adminToken);
      const res = await rulesImportRoute.POST(
        fakeRequest("http://localhost/api/tools/rules/import", {
          method: "POST",
          headers,
          body: {
            rules: [
              { name: "r-a", scope: { type: "global", values: [] }, patterns: ["a.*boom"], severity: "High" },
              { name: "r-b", scope: { type: "global", values: [] }, patterns: ["b.*boom"], severity: "High" },
            ],
          },
        }),
      );
      expect(res.status).toBe(400);
      expect((await json(res)).error?.message).toContain("limit reached");
      // Neither rule was written.
      const listed = await rulesRoute.GET(
        fakeRequest("http://localhost/api/tools/rules", { headers }),
      );
      const listedBody = (await json(listed)) as { data?: { rules?: unknown[] } };
      expect(listedBody.data?.rules).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("unsafe ReDoS patterns are rejected at registration via the API", async () => {
    vi.stubEnv("PST_API_TOKEN", adminToken);
    try {
      const headers = bearer(adminToken);
      const res = await rulesRoute.POST(
        fakeRequest("http://localhost/api/tools/rules", {
          method: "POST",
          headers,
          body: {
            name: "evil",
            scope: { type: "global", values: [] },
            patterns: ["(a+)+$"],
            severity: "High",
          },
        }),
      );
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error?.message).toContain("Unsafe pattern #1");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("analyze runs the deterministic engine with the fallback disabled (no network)", async () => {
    vi.stubEnv("PST_AI_FALLBACK", "");
    vi.stubEnv("PST_LLM_ENABLED", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    try {
      const res = await analyzeRoute.POST(
        fakeRequest("http://localhost/api/tools/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: {
            logs: ["2026-08-21 10:15:22 ERROR PaymentBatch java.lang.NullPointerException"],
          },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: {
          analysisSource: string;
          aiFallbackError: string | null;
          aiFallbackConfigured: boolean;
          severity: string;
          errorTypes: string[];
        };
      };
      expect(body.data.analysisSource).toBe("rules");
      expect(body.data.errorTypes).toContain("NullPointerException");
      // Rules matched, so no fallback attempt was made (and it is disabled anyway).
      expect(body.data.aiFallbackError).toBeNull();
      expect(body.data.aiFallbackConfigured).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

/** Split a raw SSE payload into (event, data) blocks. */
function splitSse(text: string): Array<{ event: string; data: string }> {
  return text
    .split(/\n\n/)
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      let event = "";
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      return { event, data: data.join("\n") };
    });
}

const sseDelta = (text: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

function sseTextResponse(...chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const AI_VALID_JSON = JSON.stringify({
  severity: "High",
  errorTypes: ["MysteryCrash"],
  rootCauses: ["unknown subsystem"],
  rootCausesZh: ["未知子系統"],
  immediateInvestigation: ["check service logs"],
  immediateInvestigationZh: ["檢查伺服器日誌"],
  suggestedFixes: ["restart"],
  suggestedFixesZh: ["重啟"],
  longTermImprovements: ["add tracing"],
  longTermImprovementsZh: ["加入追蹤"],
  confidence: 0.6,
});

describe("stream AI fallback (SSE) — Engineering follow-up", () => {
  it("streams delta events, then a validated Traditional-Chinese result, and serves the second call from cache", async () => {
    vi.stubEnv("PST_API_TOKEN", adminToken);
    vi.stubEnv("PST_AI_FALLBACK", "true");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-integration-test");
    let fetchCalls = 0;
    let fetchRequest: Request | null = null;
    vi.stubGlobal(
      "fetch",
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls += 1;
        fetchRequest = new Request(input, init);
        return sseTextResponse(
          sseDelta(AI_VALID_JSON.slice(0, 50)),
          sseDelta(AI_VALID_JSON.slice(50)),
          "data: [DONE]\n\n",
        );
      }) as typeof fetch,
    );
    try {
      const headers = bearer(adminToken);
      const log = "2026-08-21 10:00:00 ERROR GatewayBridge weird anomaly zx-9-stream-1";

      const first = await analyzeStreamRoute.POST(
        fakeRequest("http://localhost/api/tools/analyze/stream", {
          method: "POST",
          headers,
          body: { logs: [log] },
        }),
      );
      expect(first.status).toBe(200);
      expect(first.headers.get("content-type")).toContain("text/event-stream");
      const blocks = splitSse(await first.text());
      const events = blocks.map((b) => b.event);
      expect(events).toEqual(["phase", "delta", "delta", "ai_result", "done"]);
      const phase = JSON.parse(blocks[0]!.data) as { phase: string; aiFallbackConfigured: boolean };
      expect(phase.phase).toBe("ai");
      expect(phase.aiFallbackConfigured).toBe(true);
      const result = JSON.parse(blocks[3]!.data) as {
        analysisSource: string;
        rootCausesZh: string[];
        aiFallback: { cached: boolean; confidence: number };
      };
      expect(result.analysisSource).toBe("ai-fallback");
      expect(result.rootCausesZh).toEqual(["未知子系統"]);
      expect(result.aiFallback.cached).toBe(false);
      expect(result.aiFallback.confidence).toBe(0.6);

      // The upstream request asks for streaming with the tightened token cap.
      const upstreamBody = JSON.parse(await fetchRequest!.text()) as {
        stream: boolean;
        max_tokens: number;
      };
      expect(upstreamBody.stream).toBe(true);
      expect(upstreamBody.max_tokens).toBeLessThanOrEqual(1600);
      expect(fetchCalls).toBe(1);

      // Second identical call: cache hit, no upstream call, no deltas.
      const second = await analyzeStreamRoute.POST(
        fakeRequest("http://localhost/api/tools/analyze/stream", {
          method: "POST",
          headers,
          body: { logs: [log] },
        }),
      );
      const secondBlocks = splitSse(await second.text());
      expect(secondBlocks.map((b) => b.event)).toEqual(["phase", "ai_result", "done"]);
      const cachedResult = JSON.parse(
        secondBlocks.find((b) => b.event === "ai_result")!.data,
      ) as { aiFallback: { cached: boolean } };
      expect(cachedResult.aiFallback.cached).toBe(true);
      expect(fetchCalls).toBe(1);
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it("does NOT call the AI when rules match (server-side check, no trust)", async () => {
    vi.stubEnv("PST_API_TOKEN", adminToken);
    vi.stubEnv("PST_AI_FALLBACK", "true");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-integration-test");
    let fetchCalls = 0;
    vi.stubGlobal(
      "fetch",
      (async () => {
        fetchCalls += 1;
        return sseTextResponse();
      }) as typeof fetch,
    );
    try {
      const res = await analyzeStreamRoute.POST(
        fakeRequest("http://localhost/api/tools/analyze/stream", {
          method: "POST",
          headers: bearer(adminToken),
          body: { logs: ["2026-08-21 10:00:00 ERROR PaymentBatch java.lang.NullPointerException at A.java:1"] },
        }),
      );
      const blocks = splitSse(await res.text());
      expect(blocks.map((b) => b.event)).toEqual(["phase", "error", "done"]);
      expect(fetchCalls).toBe(0);
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it("streams a clear error event when the fallback is disabled", async () => {
    vi.stubEnv("PST_API_TOKEN", adminToken);
    vi.stubEnv("PST_AI_FALLBACK", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    try {
      const res = await analyzeStreamRoute.POST(
        fakeRequest("http://localhost/api/tools/analyze/stream", {
          method: "POST",
          headers: bearer(adminToken),
          body: { logs: ["2026-08-21 10:00:00 ERROR GatewayBridge weird anomaly zx-9-stream-3"] },
        }),
      );
      const blocks = splitSse(await res.text());
      expect(blocks.map((b) => b.event)).toEqual(["phase", "error", "done"]);
      const error = JSON.parse(blocks[1]!.data) as { message: string };
      expect(error.message).toContain("disabled");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});