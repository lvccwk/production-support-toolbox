import type { Severity } from "@/types";

/**
 * OpenAPI 3.1 document for the whole production-support-toolbox API —
 * served at GET /api/openapi.json so agents and integrators can self-discover
 * the surface (scopes, schemas, examples) instead of reading the README.
 *
 * The document is generated from one central registry (buildOpenApiDoc) so it
 * cannot drift from the routes the way a hand-maintained doc would.
 *
 * Notes encoded here:
 *   - every response is the ApiEnvelope `{ ok, data }` (or `{ ok, error }`),
 *   - auth is OPTIONAL in the default local mode and REQUIRED in remote mode
 *     (Authorization: Bearer <token>, scope read < write < admin),
 *   - stateless tool endpoints are always open (`security: []`),
 *   - data endpoints list `bearerAuth` (enforced only when PST_REMOTE_ACCESS).
 */

type JsonSchema = Record<string, unknown>;

const SEVERITIES: Severity[] = ["Critical", "High", "Medium", "Low", "Informational"];

const severitySchema: JsonSchema = { type: "string", enum: SEVERITIES };

function lazyRef(name: string): { $ref: string } {
  return { $ref: `#/components/schemas/${name}` };
}

const apiEnvelope: JsonSchema = {
  type: "object",
  description:
    "Every response is this envelope. Success: { ok: true, data }. Failure: { ok: false, error: { code, message, requestId } }.",
  properties: {
    ok: { type: "boolean" },
    data: { type: "object", additionalProperties: true, nullable: true },
    error: { ...lazyRef("ApiErrorBody"), nullable: true },
  },
};

const apiErrorBody: JsonSchema = {
  type: "object",
  properties: {
    code: {
      type: "string",
      enum: [
        "VALIDATION_ERROR",
        "UNAUTHENTICATED",
        "FORBIDDEN",
        "NOT_FOUND",
        "CONFLICT",
        "RATE_LIMITED",
        "PAYLOAD_TOO_LARGE",
        "SERVICE_UNAVAILABLE",
        "INTERNAL_ERROR",
      ],
    },
    message: { type: "string" },
    requestId: { type: "string" },
    status: { type: "integer" },
  },
};

const ruleScope: JsonSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["global", "systems", "components"] },
    values: { type: "array", items: { type: "string" } },
  },
};

const customRule: JsonSchema = {
  type: "object",
  properties: {
    id: { type: "integer", description: "Storage id (engine rule id = custom:<id>)." },
    name: { type: "string" },
    scope: lazyRef("RuleScope"),
    patterns: { type: "array", items: { type: "string" }, description: "JS/PCRE-ish regexes, one per entry." },
    severity: severitySchema,
    affectedComponents: { type: "array", items: { type: "string" } },
    rootCauses: { type: "array", items: { type: "string" } },
    investigation: { type: "array", items: { type: "string" } },
    suggestedFixes: { type: "array", items: { type: "string" } },
    longTermImprovements: { type: "array", items: { type: "string" } },
    active: { type: "boolean" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
};

const incident: JsonSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    title: { type: "string" },
    system: { type: "string" },
    environment: { type: "string" },
    severity: severitySchema,
    detectedAt: { type: "string" },
    symptoms: { type: "string" },
    rootCause: { type: "string" },
    immediateFix: { type: "string" },
    permanentFix: { type: "string" },
    status: { type: "string", enum: ["Investigating", "Identified", "Fixed", "Monitoring", "Closed"] },
    notes: { type: "string" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
};

const historyEntry: JsonSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    createdAt: { type: "string", description: "ISO timestamp (preserved on import)." },
    tool: { type: "string", enum: ["log-analyzer", "log-comparison", "json", "sql", "timestamp", "http", "encoding", "cron"] },
    system: { type: "string" },
    summary: { type: "string" },
    severity: { ...severitySchema, nullable: true },
    payload: { type: "string", description: "JSON payload used to re-open the saved analysis (≤ 200k chars)." },
  },
};

const dashboardSummary: JsonSchema = {
  type: "object",
  properties: {
    generatedAt: { type: "string" },
    history: {
      type: "object",
      properties: {
        total: { type: "integer" },
        aiFallbackCount: { type: "integer", description: "Log-analyzer entries analysed by the AI fallback." },
        bySeverity: {
          type: "array",
          items: { type: "object", properties: { severity: severitySchema, count: { type: "integer" } } },
        },
        byTool: { type: "array", items: lazyRef("NameCount") },
        bySystem: { type: "array", items: lazyRef("NameCount") },
        errorTypes: { type: "array", items: lazyRef("NameCount"), description: "Top error types from stored analysis snapshots." },
        trend: {
          type: "array",
          description: "Daily buckets, oldest first (last ?days days).",
          items: {
            type: "object",
            properties: {
              day: { type: "string" },
              total: { type: "integer" },
              highPlus: { type: "integer", description: "High or Critical that day." },
            },
          },
        },
      },
    },
    incidents: {
      type: "object",
      properties: {
        total: { type: "integer" },
        open: { type: "integer" },
        byStatus: { type: "array", items: lazyRef("NameCount") },
      },
    },
  },
};

const alertCondition: JsonSchema = {
  type: "object",
  properties: {
    minSeverity: severitySchema,
    errorTypes: { type: "array", items: { type: "string" }, description: "Optional: fire only when any listed error type is present." },
    systems: { type: "array", items: { type: "string" }, description: "Optional system filter (empty = all)." },
    tools: { type: "array", items: { type: "string" }, description: "Default ['log-analyzer']." },
  },
};

const alertChannel: JsonSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["webhook"] },
    url: { type: "string", format: "uri", description: "http(s) URL; generic POST JSON (Teams/Slack/anything)." },
  },
  required: ["type", "url"],
};

const alertRule: JsonSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    name: { type: "string" },
    active: { type: "boolean" },
    condition: lazyRef("AlertCondition"),
    channels: { type: "array", items: lazyRef("AlertChannel") },
    cooldownMinutes: { type: "integer", description: "Per (rule, signal) anti-spam cooldown." },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
};

const notification: JsonSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    createdAt: { type: "string" },
    ruleId: { type: "integer", nullable: true },
    ruleName: { type: "string" },
    level: severitySchema,
    title: { type: "string" },
    message: { type: "string" },
    channel: { type: "string", enum: ["webhook", "in-app", "test"] },
    status: { type: "string", enum: ["sent", "failed"] },
    detail: { type: "string", description: "Delivery detail (HTTP status / error). Never user data." },
  },
};

/** Outgoing webhook body — alert rule + a SAFE summary, never raw logs. */
function webhookPayloadSchema(): JsonSchema {
  return {
    type: "object",
    description:
      "Outgoing webhook body (generic POST JSON, Content-Type: application/json). Contains the alert rule, a safe summary of the saved entry (id/tool/system/summary/severity) and error types — NEVER the raw log payload.",
    properties: {
      event: { type: "string", enum: ["history.saved", "alert.test"] },
      firedAt: { type: "string" },
      rule: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          minSeverity: severitySchema,
          cooldownMinutes: { type: "integer" },
        },
      },
      entry: {
        type: "object",
        nullable: true,
        properties: {
          id: { type: "integer" },
          createdAt: { type: "string" },
          tool: { type: "string" },
          system: { type: "string" },
          summary: { type: "string" },
          severity: severitySchema,
        },
      },
      analysis: { type: "object", properties: { errorTypes: { type: "array", items: { type: "string" } } } },
    },
  };
}

function okResponse(description: string): JsonSchema {
  return {
    description,
    content: { "application/json": { schema: lazyRef("ApiEnvelope") } },
  };
}

const idParam: JsonSchema = {
  in: "path",
  name: "id",
  required: true,
  schema: { type: "integer", minimum: 1 },
  description: "Row id.",
};

function errorResponses(): Record<string, JsonSchema> {
  return {
    "400": { description: "Validation error.", content: { "application/json": { schema: lazyRef("ApiErrorBody") } } },
    "401": { description: "Missing/invalid bearer token (remote mode).", content: { "application/json": { schema: lazyRef("ApiErrorBody") } } },
    "403": { description: "Insufficient scope (read < write < admin).", content: { "application/json": { schema: lazyRef("ApiErrorBody") } } },
    "404": { description: "Resource not found.", content: { "application/json": { schema: lazyRef("ApiErrorBody") } } },
    "500": { description: "Internal error (sanitized; detail only in server logs).", content: { "application/json": { schema: lazyRef("ApiErrorBody") } } },
  };
}

/** Attach the standard error responses to an operation object. */
function withErrors(op: JsonSchema): JsonSchema {
  return { ...op, responses: { ...(op.responses as Record<string, unknown>), ...errorResponses() } };
}

/** Stateless tool operation — always open, no auth, standard errors. */
function openTool(
  summary: string,
  description: string,
  example: Record<string, unknown>,
  output: string,
): JsonSchema {
  return withErrors({
    summary,
    description: `${description} Always open (no auth, even in remote mode).`,
    security: [],
    requestBody: {
      required: true,
      content: { "application/json": { schema: { type: "object", properties: {}, example }, example } },
    },
    responses: okResponse(output),
  });
}

/** Data operation requiring bearer auth (enforced only in remote mode). */
function authGet(summary: string, description: string, output: string): JsonSchema {
  return withErrors({
    summary,
    description,
    responses: okResponse(output),
    security: [{ bearerAuth: [] }],
  });
}

function authPost(summary: string, description: string, output: string): JsonSchema {
  return withErrors({
    summary,
    description,
    responses: okResponse(output),
    security: [{ bearerAuth: [] }],
  });
}

function authPut(summary: string, description: string, output: string): JsonSchema {
  return withErrors({
    summary,
    description,
    responses: okResponse(output),
    security: [{ bearerAuth: [] }],
  });
}

function authDelete(summary: string, description: string, output: string): JsonSchema {
  return withErrors({
    summary,
    description,
    responses: okResponse(output),
    security: [{ bearerAuth: [] }],
  });
}

export function buildOpenApiDoc(): Record<string, unknown> {
  const operations: Record<string, Record<string, JsonSchema>> = {
    "/api/tools": {
      get: withErrors({
        summary: "Tool manifest",
        description:
          "Machine-readable list of ALL stateless tool endpoints (input shape + example) so an agent can self-serve without the GUI. Always open.",
        security: [],
        responses: okResponse("The tool manifest (see /api/tools response)."),
      }),
    },
    "/api/tools/analyze": {
      post: withErrors({
        summary: "Log analysis (deterministic rule engine + optional AI fallback)",
        description:
          "Analyse a log locally: severity, error types, evidence lines, extracted fields. Bilingual (…Zh fields always Traditional Chinese 繁體). When NO rule matches AND PST_AI_FALLBACK=true, the AI fallback fills a structured analysis (analysisSource: ai-fallback) — otherwise rules-only with unknownTriage for unmatched error lines. Always open.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  logs: { type: "string", description: "Full log text." },
                  system: { type: "string", description: "Optional system hint (custom-rule scoping + past-incident recall)." },
                },
                required: ["logs"],
              },
              example: {
                logs: "2026-08-21 10:15:22 ERROR PaymentBatch java.lang.NullPointerException at PaymentService.java:125",
                system: "ledger",
              },
            },
          },
        },
        responses: okResponse(
          "LogAnalysis: severity, errorTypes, affectedComponents, rootCauses(+Zh), immediateInvestigation(+Zh), suggestedFixes(+Zh), longTermImprovements(+Zh), matchedRuleIds, matchedEvidence, unknownTriage, extracted, maskedKeys, summary, analysisSource, aiFallback{...}",
        ),
      }),
    },
    "/api/tools/analyze/stream": {
      post: withErrors({
        summary: "Log analysis with SSE streaming (AI fallback progress)",
        description:
          "Same result as /api/tools/analyze but the AI fallback (when it triggers) streams progress via Server-Sent Events: events phase | delta | ai_result | error | done. Rules-only runs still stream (phase + done). Always open.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: { logs: { type: "string" }, system: { type: "string" } }, required: ["logs"] },
            },
          },
        },
        responses: { description: "text/event-stream of {phase,delta,ai_result,error,done} events." },
      }),
    },
    "/api/tools/compare": {
      post: openTool(
        "Log comparison",
        "Compare before/after logs: new errors, missing errors, changed HTTP codes, regression verdict.",
        { before: "HTTP 200", after: "HTTP 500\njava.lang.NullPointerException" },
        "newErrors, missingErrors, changedHttpStatuses, addedLines, removedLines, severityBefore/After, regression, summary",
      ),
    },
    "/api/tools/json": {
      post: openTool(
        "JSON toolbox",
        "Format, validate, minify or search JSON keys/values.",
        { input: '{"name":"ABC","status":"ERROR"}', action: "format | validate | minify | search", query: "only for search" },
        "output (format/minify) | valid/error (validate) | hits (search)",
      ),
    },
    "/api/tools/sql": {
      post: openTool(
        "SQL toolbox",
        "TEXT ONLY — never executes: format, safety check or basic analysis.",
        { input: "UPDATE customer SET status='X';", action: "format | safety | analyze" },
        "output | issues (safety) | statement/tables/clauses (analyze)",
      ),
    },
    "/api/tools/timestamp": {
      post: openTool(
        "Timestamp converter",
        "Convert between Unix s/ms, ISO 8601, UTC and local time in any IANA timezone.",
        { input: "1787299200 or 2026-08-21 16:00:00", timezone: "optional" },
        "unixSeconds, unixMilliseconds, iso8601, local, utc, timezone, parsedAs",
      ),
    },
    "/api/tools/http": {
      post: openTool(
        "HTTP status helper",
        "Searchable HTTP status reference (meaning, common production causes, what to check).",
        { query: "503 | gateway timeout | 4xx" },
        "entries[]",
      ),
    },
    "/api/tools/encoding": {
      post: openTool(
        "Base64 / URL",
        "Base64 (UTF-8) and URL encode/decode.",
        { input: "hello world", action: "base64-encode | url-encode" },
        "output",
      ),
    },
    "/api/tools/cron": {
      post: openTool(
        "Cron helper",
        "Describe a 5-field cron expression + next 5 runs.",
        { expression: "0 8 * * *" },
        "human, nextRuns, nextRunsUnix",
      ),
    },

    "/api/incidents": {
      get: withErrors({
        ...authGet("List incidents", "Optional ?q= full-text search. Scope: read.", "Incident[]"),
        parameters: [{ in: "query", name: "q", schema: { type: "string" }, description: "Search term." }],
      }),
      post: withErrors({
        ...authPost("Create incident", "Scope: write.", "Created Incident (201)."),
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", example: { title: "Ledger batch failed", system: "ledger", severity: "High", status: "Investigating" } },
            },
          },
        },
      }),
    },
    "/api/incidents/{id}": {
      get: withErrors({ ...authGet("Get incident", "Scope: read.", "Incident"), parameters: [idParam] }),
      put: withErrors({
        ...authPut("Update incident", "Full update (validated). Scope: write.", "Updated Incident."),
        parameters: [idParam],
        requestBody: { required: true, content: { "application/json": { schema: lazyRef("Incident") } } },
      }),
      delete: withErrors({
        ...authDelete("Delete incident", "Scope: admin.", "{ deleted: true }"),
        parameters: [idParam],
      }),
    },
    "/api/history": {
      get: withErrors({
        ...authGet("List saved analyses", "Optional ?q= search (tool/system/summary/payload). Scope: read.", "HistoryEntry[]"),
        parameters: [{ in: "query", name: "q", schema: { type: "string" }, description: "Search term." }],
      }),
      post: withErrors({
        ...authPost(
          "Save an analysis",
          "Explicit save (never automatic). Evaluates alert rules against the entry — matching rules fire local notifications and (optionally) webhooks; a broken webhook never fails the save. Scope: write.",
          "Created HistoryEntry (201).",
        ),
        requestBody: { required: true, content: { "application/json": { schema: lazyRef("HistoryEntry") } } },
      }),
    },
    "/api/history/{id}": {
      get: withErrors({ ...authGet("Get a saved analysis", "Scope: read.", "HistoryEntry"), parameters: [idParam] }),
      delete: withErrors({
        ...authDelete("Delete a saved analysis", "Scope: admin.", "{ deleted: true }"),
        parameters: [idParam],
      }),
    },
    "/api/export": {
      get: withErrors({
        ...authGet(
          "Export data",
          "format=json (full backup bundle, schema v2) | csv; kind=incidents|history for CSV. Download attachment. Scope: admin.",
          "JSON bundle or CSV text (attachment).",
        ),
        parameters: [
          { in: "query", name: "format", schema: { type: "string", enum: ["json", "csv"] }, description: "Export format." },
          { in: "query", name: "kind", schema: { type: "string", enum: ["incidents", "history"] }, description: "CSV kind." },
        ],
      }),
    },
    "/api/import": {
      post: withErrors({
        ...authPost(
          "Import a backup bundle",
          "All-or-nothing restore (dedupe by content hash; rules by scope+name+patterns). Scope: admin.",
          "ImportResult { importedIncidents, importedHistory, importedRules, skipped, skippedRules }.",
        ),
        requestBody: { required: true, content: { "application/json": { schema: lazyRef("BackupBundle") } } },
      }),
    },
    "/api/tools/rules": {
      get: withErrors({
        ...authGet(
          "List custom rules",
          "Optional ?scope=global|systems|components, ?system=, ?component= (which rules WOULD apply), ?export=json (full bundle). Returns { rules, activeCount, cap }. Scope: read.",
          "{ rules: CustomRule[], activeCount, cap }.",
        ),
        parameters: [
          { in: "query", name: "scope", schema: { type: "string", enum: ["global", "systems", "components"] }, description: "Scope filter." },
          { in: "query", name: "system", schema: { type: "string" }, description: "Systems scope filter." },
          { in: "query", name: "component", schema: { type: "string" }, description: "Components scope filter." },
          { in: "query", name: "export", schema: { type: "string", enum: ["json"] }, description: "Full export bundle." },
        ],
      }),
      post: withErrors({
        ...authPost(
          "Register a custom rule",
          "Validated: regex syntax + static ReDoS screening + time-bounded torture test + caps. Body: { name, scope, patterns[], severity, rootCauses[], investigation[], suggestedFixes[], ... , active? }. Scope: write.",
          "Created rule (201).",
        ),
        requestBody: { required: true, content: { "application/json": { schema: lazyRef("CustomRule") } } },
      }),
    },
    "/api/tools/rules/{id}": {
      get: withErrors({ ...authGet("Get a custom rule", "Scope: read.", "{ rule }"), parameters: [idParam] }),
      put: withErrors({
        ...authPut(
          "Update a custom rule",
          "Full/partial update — the FINAL merged pattern set is re-torture-tested before storing. Scope: write.",
          "{ rule }",
        ),
        parameters: [idParam],
        requestBody: { required: true, content: { "application/json": { schema: lazyRef("CustomRule") } } },
      }),
      delete: withErrors({
        ...authDelete("Delete a custom rule", "Scope: admin.", "{ deleted: true }"),
        parameters: [idParam],
      }),
    },
    "/api/tools/rules/import": {
      post: withErrors({
        ...authPost(
          "Bulk-import custom rules",
          "Atomic all-or-nothing; duplicates skipped. Body: { rules: CustomRuleInput[] } or an export bundle. Scope: admin.",
          "{ imported, skipped, total }",
        ),
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: { rules: { type: "array", items: lazyRef("CustomRule") } } },
            },
          },
        },
      }),
    },
    "/api/dashboard": {
      get: withErrors({
        ...authGet(
          "Dashboard summary",
          "Aggregated report: totals, severity/tool/system distribution, top error types, daily High+ trend, incident statuses. ?days=7..90 (default 14). Scope: read.",
          "DashboardSummary",
        ),
        parameters: [{ in: "query", name: "days", schema: { type: "integer", minimum: 1, maximum: 90 }, description: "Trend horizon." }],
      }),
    },
    "/api/alerts": {
      get: withErrors({
        ...authGet("List alert rules", "Returns { rules: AlertRule[], alertsEnabled } (PST_ALERTS_ENABLED). Scope: read.", "{ rules, alertsEnabled }"),
      }),
      post: withErrors({
        ...authPost(
          "Create an alert rule",
          "Validated: name, condition (minSeverity, optional errorTypes/systems/tools), channels (http(s) webhook URLs), cooldownMinutes. Scope: write.",
          "Created rule (201).",
        ),
        requestBody: { required: true, content: { "application/json": { schema: lazyRef("AlertRule") } } },
      }),
    },
    "/api/alerts/{id}": {
      get: withErrors({ ...authGet("Get an alert rule", "Scope: read.", "{ rule }"), parameters: [idParam] }),
      put: withErrors({
        ...authPut("Update an alert rule", "Partial update (merged against stored rule, validated). Scope: write.", "{ rule }"),
        parameters: [idParam],
        requestBody: { required: true, content: { "application/json": { schema: lazyRef("AlertRule") } } },
      }),
      delete: withErrors({
        ...authDelete("Delete an alert rule", "Also clears its cooldown keys. Scope: admin.", "{ deleted: true }"),
        parameters: [idParam],
      }),
    },
    "/api/alerts/{id}/test": {
      post: withErrors({
        summary: "Send a test alert",
        description:
          "Delivers a TEST payload to the rule's webhook(s) (or records in-app-only) and returns { delivered, detail, notificationId }. A webhook rejection is NOT an API error — check delivered. Scope: write.",
        responses: okResponse("{ delivered: boolean, detail: string, notificationId: integer|null }."),
        security: [{ bearerAuth: [] }],
        parameters: [idParam],
      }),
    },
    "/api/notifications": {
      get: withErrors({
        ...authGet(
          "List notifications",
          "Newest first. ?limit=1..500 (default 100). Scope: read. Every alert firing is always recorded here, even when webhook delivery failed.",
          "{ notifications: Notification[] }",
        ),
        parameters: [{ in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 500 }, description: "Page size." }],
      }),
      delete: withErrors({
        ...authDelete("Clear the notification log", "Scope: admin (not recoverable).", "{ removed: integer }"),
      }),
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "Production Support Toolbox API",
      version: "1.0.0",
      description:
        "Local-first, agent-first toolbox API. Everything is deterministic, local and free — the rule engine runs entirely on this machine; AI is only an opt-in fallback for rule-engine misses (PST_AI_FALLBACK=true). All responses use the ApiEnvelope shape. Bilingual text fields (…Zh) are always Traditional Chinese 繁體中文.\n\nAuth: default local mode = no auth. Remote mode (PST_REMOTE_ACCESS=true) requires Authorization: Bearer <token> on data endpoints (scopes read < write < admin); stateless tool endpoints stay open. This document is served at /api/openapi.json.",
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "Tools", description: "Stateless, deterministic tools (always open)." },
      { name: "Data", description: "Incidents / history / export / import (auth in remote mode)." },
      { name: "Rules", description: "Custom rule registry." },
      { name: "Reports", description: "Dashboard aggregation." },
      { name: "Alerts", description: "Alert rules, notifications and webhooks." },
    ],
    security: [{ bearerAuth: [] }],
    paths: operations,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Authorization: Bearer <token>. Optional in local mode; required in remote mode.",
        },
      },
      schemas: {
        ApiEnvelope: apiEnvelope,
        ApiErrorBody: apiErrorBody,
        Severity: severitySchema,
        RuleScope: ruleScope,
        CustomRule: customRule,
        Incident: incident,
        HistoryEntry: historyEntry,
        NameCount: { type: "object", properties: { name: { type: "string" }, count: { type: "integer" } } },
        DashboardSummary: dashboardSummary,
        AlertCondition: alertCondition,
        AlertChannel: alertChannel,
        AlertRule: alertRule,
        Notification: notification,
        WebhookPayload: webhookPayloadSchema(),
        BackupBundle: {
          type: "object",
          description: "Full backup bundle (schemaVersion 1|2): incidents + history (+ customRules in v2).",
          properties: {
            schemaVersion: { type: "integer", enum: [1, 2] },
            exportedAt: { type: "string" },
            incidents: { type: "array", items: lazyRef("Incident") },
            history: { type: "array", items: lazyRef("HistoryEntry") },
            customRules: { type: "array", items: lazyRef("CustomRule") },
          },
        },
      },
    },
  };
}