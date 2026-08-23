import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { closeDb, initDb } from "@/lib/database/db";

import * as dashboardRoute from "@/app/api/dashboard/route";
import * as alertsRoute from "@/app/api/alerts/route";
import * as alertIdRoute from "@/app/api/alerts/[id]/route";
import * as alertTestRoute from "@/app/api/alerts/[id]/test/route";
import * as notificationsRoute from "@/app/api/notifications/route";
import * as openapiRoute from "@/app/api/openapi.json/route";
import * as historyRoute from "@/app/api/history/route";
import { processAlertJobs } from "@/lib/database/alerts";

/**
 * Integration tests for the reporting/alerts API family (Dashboard, Alert
 * rules, notifications, OpenAPI). Real Next.js handlers + real temp SQLite;
 * the outgoing webhook fetch is stubbed so tests stay hermetic.
 */

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

async function json(res: Response): Promise<{ ok?: boolean; data?: unknown; error?: unknown }> {
  return (await res.json()) as never;
}

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pst-newroutes-"));
});

beforeEach(() => {
  seq += 1;
  initDb(path.join(tempDir, `new-${seq}.db`));
  vi.unstubAllEnvs();
  vi.stubGlobal(
    "fetch",
    async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("GET /api/dashboard", () => {
  it("returns an all-zero summary on an empty database (local mode, no auth)", async () => {
    const res = await dashboardRoute.GET(fakeRequest("http://localhost/api/dashboard"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    const data = body.data as { history: { total: number; trend: unknown[] }; incidents: { total: number } };
    expect(data.history.total).toBe(0);
    expect(data.history.trend).toHaveLength(14);
    expect(data.incidents.total).toBe(0);
  });

  it("respects the ?days= range", async () => {
    const res = await dashboardRoute.GET(fakeRequest("http://localhost/api/dashboard?days=7"));
    const body = await json(res);
    const data = body.data as { history: { trend: unknown[] } };
    expect(data.history.trend).toHaveLength(7);
  });
});

describe("Alert rules routes", () => {
  const ruleBody = {
    name: "High SQL errors",
    condition: {
      minSeverity: "High",
      errorTypes: ["SQL Exception"],
      systems: [],
      tools: ["log-analyzer"],
    },
    channels: [{ type: "webhook", url: "https://hooks.example.com/team" }],
    cooldownMinutes: 30,
  };

  it("remote mode is fail-closed on protected alert routes", async () => {
    vi.stubEnv("PST_REMOTE_ACCESS", "true");
    vi.stubEnv("PST_API_TOKEN", "");
    const res = await alertsRoute.GET(fakeRequest("http://localhost/api/alerts"));
    expect(res.status).toBe(503);
  });

  it("returns rules + alertsEnabled flag", async () => {
    const res = await alertsRoute.GET(fakeRequest("http://localhost/api/alerts"));
    expect(res.status).toBe(200);
    const body = await json(res);
    const data = body.data as { rules: unknown[]; alertsEnabled: boolean };
    expect(data.rules).toEqual([]);
    expect(data.alertsEnabled).toBe(true);
  });

  it("creates / updates / deletes an alert rule", async () => {
    const create = await alertsRoute.POST(
      fakeRequest("http://localhost/api/alerts", { method: "POST", body: ruleBody }),
    );
    expect(create.status).toBe(201);
    const created = (await json(create)).data as { rule: { id: number; name: string } };
    expect(created.rule.name).toBe("High SQL errors");

    const list = await alertsRoute.GET(fakeRequest("http://localhost/api/alerts"));
    const listed = (await json(list)).data as { rules: Array<{ id: number }> };
    expect(listed.rules).toHaveLength(1);

    const get = await alertIdRoute.GET(fakeRequest("http://localhost/api/alerts/1"), fakeParams("1"));
    expect(get.status).toBe(200);

    const update = await alertIdRoute.PUT(
      fakeRequest("http://localhost/api/alerts/1", {
        method: "PUT",
        body: { cooldownMinutes: 5 },
      }),
      fakeParams("1"),
    );
    expect(update.status).toBe(200);
    const updated = (await json(update)).data as { rule: { cooldownMinutes: number } };
    expect(updated.rule.cooldownMinutes).toBe(5);

    const missing = await alertIdRoute.GET(
      fakeRequest("http://localhost/api/alerts/999"),
      fakeParams("999"),
    );
    expect(missing.status).toBe(404);

    const del = await alertIdRoute.DELETE(
      fakeRequest("http://localhost/api/alerts/1", { method: "DELETE" }),
      fakeParams("1"),
    );
    expect(del.status).toBe(200);
    const listedAfter = await alertsRoute.GET(fakeRequest("http://localhost/api/alerts"));
    const after = (await json(listedAfter)).data as { rules: unknown[] };
    expect(after.rules).toHaveLength(0);
  });

  it("saves a High+ analysis -> matching alert fires -> notification recorded", async () => {
    await alertsRoute.POST(fakeRequest("http://localhost/api/alerts", { method: "POST", body: ruleBody }));

    const save = await historyRoute.POST(
      fakeRequest("http://localhost/api/history", {
        method: "POST",
        body: {
          tool: "log-analyzer",
          system: "ledger",
          summary: "SQL exception in batch",
          severity: "Critical",
          payload: JSON.stringify({
            input: "ERROR SQL Exception",
            analysis: {
              severity: "Critical",
              errorTypes: ["SQL Exception"],
              affectedComponents: [],
              rootCauses: [],
              immediateInvestigation: [],
              suggestedFixes: [],
              longTermImprovements: [],
              matchedRuleIds: ["builtin:sql"],
              unknownTriage: null,
              matchedEvidence: [],
            },
            analysisSource: "rules",
          }),
        },
      }),
    );
    expect(save.status).toBe(201);

    // Delivery is async (the route kicks the worker fire-and-forget, and the
    // worker interval also drains). Poll until the notification settles.
    let status = "pending";
    for (let i = 0; i < 50; i += 1) {
      const notif = await notificationsRoute.GET(fakeRequest("http://localhost/api/notifications"));
      const body = (await json(notif)).data as { notifications: Array<{ ruleName: string; status: string }> };
      if (body.notifications.length === 0) throw new Error("expected a notification");
      status = body.notifications[0].status;
      if (status === "sent") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    // Also prove the worker path itself drains (idempotent — nothing left to do).
    await processAlertJobs();

    const notif = await notificationsRoute.GET(fakeRequest("http://localhost/api/notifications"));
    const body = (await json(notif)).data as { notifications: Array<{ ruleName: string; status: string }> };
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0].ruleName).toBe("High SQL errors");
    expect(body.notifications[0].status).toBe("sent");
  });

  it("a low-severity save does NOT fire alerts", async () => {
    await alertsRoute.POST(fakeRequest("http://localhost/api/alerts", { method: "POST", body: ruleBody }));
    await historyRoute.POST(
      fakeRequest("http://localhost/api/history", {
        method: "POST",
        body: {
          tool: "log-analyzer",
          system: "ledger",
          summary: "minor warning",
          severity: "Low",
          payload: JSON.stringify({ analysis: { severity: "Low" }, analysisSource: "rules" }),
        },
      }),
    );
    const notif = await notificationsRoute.GET(fakeRequest("http://localhost/api/notifications"));
    const body = (await json(notif)).data as { notifications: unknown[] };
    expect(body.notifications).toHaveLength(0);
  });

  it("validates alert rule input at the API boundary (400)", async () => {
    const bad = await alertsRoute.POST(
      fakeRequest("http://localhost/api/alerts", {
        method: "POST",
        body: { name: "x", condition: { minSeverity: "Urgent" } },
      }),
    );
    expect(bad.status).toBe(400);
  });

  it("POST /api/alerts/[id]/test delivers a test notification", async () => {
    await alertsRoute.POST(fakeRequest("http://localhost/api/alerts", { method: "POST", body: ruleBody }));
    const test = await alertTestRoute.POST(fakeRequest("http://localhost/api/alerts/1/test", { method: "POST" }), fakeParams("1"));
    expect(test.status).toBe(200);
    const body = (await json(test)).data as { delivered: boolean };
    expect(body.delivered).toBe(true);

    const notif = await notificationsRoute.GET(fakeRequest("http://localhost/api/notifications"));
    const listed = (await json(notif)).data as { notifications: Array<{ channel: string }> };
    expect(listed.notifications[0].channel).toBe("test");
  });

  it("clears the notification log (admin)", async () => {
    await alertsRoute.POST(fakeRequest("http://localhost/api/alerts", { method: "POST", body: ruleBody }));
    await historyRoute.POST(
      fakeRequest("http://localhost/api/history", {
        method: "POST",
        body: {
          tool: "log-analyzer",
          system: "ledger",
          summary: "boom",
          severity: "Critical",
          payload: JSON.stringify({ analysis: { severity: "Critical", errorTypes: ["SQL Exception"] }, analysisSource: "rules" }),
        },
      }),
    );
    const clear = await notificationsRoute.DELETE(fakeRequest("http://localhost/api/notifications", { method: "DELETE" }));
    expect(clear.status).toBe(200);
    const removed = (await json(clear)).data as { removed: number };
    expect(removed.removed).toBe(1);
  });
});

describe("GET /api/openapi.json", () => {
  it("serves the generated OpenAPI document without auth", async () => {
    const res = await openapiRoute.GET();
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown>; components: { schemas: Record<string, unknown> } };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths).length).toBeGreaterThanOrEqual(20);
    expect(doc.components.schemas.ApiEnvelope).toBeDefined();
  });
});