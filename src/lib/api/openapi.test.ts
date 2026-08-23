import { describe, expect, it } from "vitest";
import { buildOpenApiDoc } from "./openapi";

const EXPECTED_PATHS = [
  "/api/tools",
  "/api/tools/analyze",
  "/api/tools/analyze/stream",
  "/api/tools/compare",
  "/api/tools/json",
  "/api/tools/sql",
  "/api/tools/timestamp",
  "/api/tools/http",
  "/api/tools/encoding",
  "/api/tools/cron",
  "/api/incidents",
  "/api/incidents/{id}",
  "/api/history",
  "/api/history/{id}",
  "/api/export",
  "/api/import",
  "/api/tools/rules",
  "/api/tools/rules/{id}",
  "/api/tools/rules/import",
  "/api/dashboard",
  "/api/alerts",
  "/api/alerts/{id}",
  "/api/alerts/{id}/test",
  "/api/notifications",
];

describe("buildOpenApiDoc", () => {
  it("is a serializable OpenAPI 3.1 document", () => {
    const doc = buildOpenApiDoc();
    expect(doc.openapi).toBe("3.1.0");
    expect((doc.info as { title: string }).title).toBe("Production Support Toolbox API");
    expect(() => JSON.stringify(doc)).not.toThrow();
  });

  it("documents every route of the API surface", () => {
    const paths = Object.keys(buildOpenApiDoc().paths as object).sort();
    expect(paths).toEqual([...EXPECTED_PATHS].sort());
  });

  it("keeps stateless tools open (security: []) and data endpoints bearer-auth'd", () => {
    const doc = buildOpenApiDoc();
    const paths = doc.paths as Record<string, { get?: { security?: unknown[] }; post?: { security?: unknown[] } }>;
    expect(paths["/api/tools"].get?.security).toEqual([]);
    expect(paths["/api/tools/analyze"].post?.security).toEqual([]);
    expect(paths["/api/incidents"].get?.security).toEqual([{ bearerAuth: [] }]);
    expect(paths["/api/history"].post?.security).toEqual([{ bearerAuth: [] }]);
  });

  it("defines the shared schemas referenced by operations", () => {
    const doc = buildOpenApiDoc();
    const schemas = ((doc.components as Record<string, unknown>).schemas ?? {}) as Record<string, unknown>;
    for (const name of [
      "ApiEnvelope",
      "ApiErrorBody",
      "Severity",
      "CustomRule",
      "Incident",
      "HistoryEntry",
      "DashboardSummary",
      "AlertRule",
      "Notification",
      "WebhookPayload",
      "BackupBundle",
    ]) {
      expect(schemas[name], `missing schema ${name}`).toBeDefined();
    }
  });

  it("describes the {id} path parameters", () => {
    const doc = buildOpenApiDoc();
    const paths = doc.paths as Record<string, { delete?: { parameters?: unknown[] } }>;
    const parameters = paths["/api/history/{id}"].delete?.parameters as Array<{ name: string; in: string }>;
    expect(parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "id", in: "path" })]),
    );
  });
});