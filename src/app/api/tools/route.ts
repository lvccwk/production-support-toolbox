import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tools — machine-readable manifest so an AGENT can self-serve:
 * list available tools, their input shape and an example, without any GUI.
 */

const TOOLS = [
  {
    id: "analyze",
    method: "POST",
    path: "/api/tools/analyze",
    description:
      "Deterministic log analysis: severity, error types, evidence lines and extracted fields (timestamps, levels, components, identifiers, exceptions, sources, HTTP statuses). Every text section is returned in BOTH English and Traditional Chinese (…Zh fields). Local rule engine first; when NO rule matches and PST_AI_FALLBACK=true, an AI fallback (OpenRouter) AUTOMATICALLY fills a structured bilingual analysis (analysisSource: ai-fallback, cached per masked-log hash).",
    input: {
      logs: [
        "2026-08-21 10:15:22 ERROR PaymentBatch java.lang.NullPointerException at PaymentService.java:125",
      ],
      system: "optional system hint (recalls past incidents for the same system)",
    },
    output:
      "severity, errorTypes, affectedComponents, rootCauses, immediateInvestigation, suggestedFixes, longTermImprovements, matchedRuleIds, evidence, unknownTriage, extracted, maskedKeys, logCount, dossierCount, summary (topErrorTypes, ruleHits, levelCounts, timeDistribution, topComponents), analysisSource (rules|ai-fallback), aiFallbackConfigured, aiFallback (cached/model/confidence), aiFallbackError",
  },
  {
    id: "compare",
    method: "POST",
    path: "/api/tools/compare",
    description:
      "Compare two logs (before/after): new errors, missing errors, changed HTTP codes, changed components, regression verdict.",
    input: { before: "HTTP 200", after: "HTTP 500\njava.lang.NullPointerException" },
    output: "newErrors, missingErrors, changedHttpStatuses, addedLines, removedLines, severityBefore/After, regression, summary",
  },
  {
    id: "json",
    method: "POST",
    path: "/api/tools/json",
    description: "JSON toolbox: format, validate, minify or search keys/values.",
    input: {
      input: '{"name":"ABC","status":"ERROR"}',
      action: "format | validate | minify | search",
      query: "required only for search (e.g. transactionId)",
    },
    output: "output (format/minify) | valid/error (validate) | hits (search)",
  },
  {
    id: "sql",
    method: "POST",
    path: "/api/tools/sql",
    description:
      "SQL toolbox — TEXT ONLY, never executes: format, safety check (UPDATE/DELETE without WHERE, DROP, TRUNCATE...) or basic analysis.",
    input: { input: "UPDATE customer SET status='X';", action: "format | safety | analyze" },
    output: "output (format) | issues (safety) | statement/tables/clauses (analyze)",
  },
  {
    id: "timestamp",
    method: "POST",
    path: "/api/tools/timestamp",
    description:
      "Convert between Unix seconds/ms, ISO 8601, UTC and local time in any IANA timezone (default Asia/Hong_Kong).",
    input: { input: "1787299200 or 2026-08-21 16:00:00 or 2026-08-21T08:00:00Z", timezone: "optional" },
    output: "unixSeconds, unixMilliseconds, iso8601, local, utc, timezone, parsedAs",
  },
  {
    id: "http",
    method: "POST",
    path: "/api/tools/http",
    description:
      "Searchable HTTP status reference: meaning, common production causes, what to check.",
    input: { query: "503 | gateway timeout | 4xx (empty = all codes)" },
    output: "entries: code, phrase, meaning, commonCauses, whatToCheck",
  },
  {
    id: "encoding",
    method: "POST",
    path: "/api/tools/encoding",
    description: "Base64 (UTF-8) and URL encode/decode.",
    input: {
      input: "hello world",
      action: "base64-encode | base64-decode | url-encode | url-decode | url-encode-path",
    },
    output: "output",
  },
  {
    id: "cron",
    method: "POST",
    path: "/api/tools/cron",
    description: "Describe a 5-field cron expression and list the next 5 execution times.",
    input: { expression: "0 8 * * *" },
    output: "human, nextRuns (ISO strings), nextRunsUnix",
  },
  {
    id: "rules",
    method: "POST + GET + PUT/DELETE",
    path: "/api/tools/rules",
    description:
      "Scoped custom rule registry: teach the engine your system/company's failure signatures. Each rule has a scope (global | systems | components) so different systems keep separate namespaces. POST to register (regex-validated), GET to list (?scope=, ?system=, ?component=, export=json), PUT/DELETE /api/tools/rules/[id] to update/remove. Custom rules are merged into /api/tools/analyze automatically.",
    input: {
      name: "PaymentBatch-STEP44-timeout",
      scope: { type: "components", values: ["PaymentBatch"] },
      patterns: ["STEP44.*timeout"],
      severity: "High",
      rootCauses: ["PAY gateway timeout at STEP44"],
    },
    output: "{ rule } | { rules } | { deleted: true }",
  },
];

export async function GET() {
  return NextResponse.json({
    ok: true,
    baseUrl: "/api/tools",
    note:
      "All /api/tools endpoints are stateless, local, deterministic and free (no LLM). Data endpoints are also available: /api/incidents, /api/history (search with ?q=), /api/export, /api/import.",
    tools: TOOLS,
  });
}