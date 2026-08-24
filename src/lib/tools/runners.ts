import type {
  ErrorType,
  EvidenceLine,
  Severity,
  SqlAnalysis,
  SqlSafetyResult,
  UnknownTriage,
  JsonSearchHit,
  JsonValidationResult,
  SourceRef,
} from "@/types";
import { ToolError } from "@/lib/errors";
import { extractLogInfo } from "@/lib/log-parser/parser";
import { analyzeLog } from "@/lib/rules/engine";
import { scopeMatches, toLogRules } from "@/lib/rules/custom";
import { redactSensitiveValues } from "@/lib/llm/redact";
import { parseLogsInput } from "@/lib/llm/logs";
import { loadIncidentDossier } from "@/lib/llm/dossier";
import { buildLogSummary, type LogSummary } from "@/lib/analysis/summary";
import { compareLogs, type ComparisonResult } from "@/lib/log-comparison/comparator";
import { formatJson, minifyJson, searchJson, validateJson } from "@/lib/json/jsonTools";
import { formatSql } from "@/lib/sql/sqlFormatter";
import { checkSqlSafety } from "@/lib/sql/sqlSafety";
import { analyzeSql } from "@/lib/sql/sqlAnalyzer";
import {
  DEFAULT_TIMEZONE,
  availableTimezones,
  convertTimestamp,
  type TimestampResult,
} from "@/lib/timestamp/converter";
import {
  base64Decode,
  base64Encode,
  urlDecode,
  urlEncode,
  urlEncodePath,
} from "@/lib/encoding/tools";
import { timedMetricAsync } from "@/lib/api/metrics";
import {
  buildFallbackContext,
  resolveFallbackOptions,
  runFallback,
} from "@/lib/llm/fallback";
import { listCustomRules } from "@/lib/database/customRules";

/**
 * Shared tool runners — the ONE implementation of every toolbox operation.
 *
 * Both consumer surfaces call these and nothing else:
 *   - the HTTP Agent API (`/api/tools/*` routes) and
 *   - the MCP server (`src/mcp/server.ts`, for Claude Code / Cursor /
 *     opencode and any other MCP client).
 *
 * Keeping the logic here (instead of duplicating it in each surface) is what
 * guarantees the GUI, the HTTP API and the MCP surface can never drift.
 * Everything is pure logic + `ToolError` validation — no Next.js, no network.
 * `analyze` additionally reads the LOCAL SQLite (custom rules + incident
 * dossier) exactly like the HTTP route, so MCP results match the API results.
 */

/* ------------------------------------------------------------------ */
/* analyze                                                             */
/* ------------------------------------------------------------------ */

export interface RunAnalyzeInput {
  /** Single log string, or an array of log strings (≤5, caps enforced). */
  log?: unknown;
  logs?: unknown;
  /** Optional system hint (custom-rule scoping + past-incident recall). */
  system?: unknown;
}

export interface FallbackMeta {
  cached: boolean;
  durationMs?: number;
  model?: string | null;
  confidence: number;
}

export interface AnalyzeToolResult {
  severity: Severity;
  errorTypes: ErrorType[];
  affectedComponents: string[];
  rootCauses: string[];
  rootCausesZh: string[];
  immediateInvestigation: string[];
  immediateInvestigationZh: string[];
  suggestedFixes: string[];
  suggestedFixesZh: string[];
  longTermImprovements: string[];
  longTermImprovementsZh: string[];
  matchedRuleIds: string[];
  evidence: Array<{ ruleId: string; ruleName: string; evidence: EvidenceLine[] }>;
  skippedRules: Array<{ ruleId: string; name: string; reason: string }>;
  unknownTriage: UnknownTriage | null;
  extracted: {
    timestamps: string[];
    levels: string[];
    components: string[];
    identifiers: Record<string, string>;
    exceptions: string[];
    sources: SourceRef[];
    httpStatuses: number[];
    stackTrace: boolean;
  };
  maskedKeys: string[];
  logCount: number;
  dossierCount: number;
  appliedCustomRules: Array<{ id: string; name: string }>;
  summary: LogSummary;
  analysisSource: "rules" | "ai-fallback";
  aiFallbackConfigured: boolean;
  aiFallback: FallbackMeta | null;
  aiFallbackError: string | null;
}

/**
 * Run the full log-analysis pipeline: redact → parse → scoped custom rules →
 * rule engine → incident dossier → summary, with the OPT-IN AI fallback when
 * zero rules match. Mirrors the old body of POST /api/tools/analyze exactly.
 */
export async function runAnalyze(
  input: RunAnalyzeInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AnalyzeToolResult> {
  const logs = parseLogsInput({
    log: input.log,
    // parseLogsInput expects `logs` to be an array (or the single `log` field);
    // a bare string is normalised here so `logs: "error ..."` works everywhere.
    logs: typeof input.logs === "string" ? [input.logs] : input.logs,
  });
  const system =
    typeof input.system === "string" ? input.system.trim().slice(0, 100) : "";

  const masking = env.PST_REDACT !== "off";
  const masked = masking
    ? redactSensitiveValues(logs.join("\n"))
    : { text: logs.join("\n"), maskedKeys: [] as string[] };

  const info = extractLogInfo(masked.text);

  // Scoped custom rules: only rules whose scope matches this analysis run.
  const customRules = toLogRules(
    listCustomRules(true).filter((rule) =>
      scopeMatches(rule.scope, {
        system: system || undefined,
        components: info.components,
      }),
    ),
  );

  const analysis = analyzeLog(masked.text, info, customRules);
  const dossier = loadIncidentDossier(system);
  const fallbackOptions = resolveFallbackOptions(env);

  // Hybrid fallback: no rule matched -> optional AI fills the analysis.
  let analysisSource: "rules" | "ai-fallback" = "rules";
  let aiFallback: FallbackMeta | null = null;
  let aiFallbackError: string | null = null;

  if (analysis.matchedRuleIds.length === 0) {
    if (fallbackOptions.enabled) {
      const { result: outcome } = await timedMetricAsync("ai_fallback", () =>
        runFallback(
          {
            lines: buildFallbackContext(masked.text),
            levels: info.levels,
            components: info.components,
            exceptions: info.exceptions,
            httpStatuses: info.httpStatuses,
          },
          fallbackOptions,
        ),
      );
      if (outcome.ok && outcome.analysis) {
        const fb = outcome.analysis;
        analysisSource = "ai-fallback";
        analysis.severity = fb.severity;
        analysis.errorTypes = fb.errorTypes as unknown as ErrorType[];
        analysis.rootCauses = fb.rootCauses;
        analysis.rootCausesZh = fb.rootCausesZh;
        analysis.immediateInvestigation = fb.immediateInvestigation;
        analysis.immediateInvestigationZh = fb.immediateInvestigationZh;
        analysis.suggestedFixes = fb.suggestedFixes;
        analysis.suggestedFixesZh = fb.suggestedFixesZh;
        analysis.longTermImprovements = fb.longTermImprovements;
        analysis.longTermImprovementsZh = fb.longTermImprovementsZh;
        aiFallback = {
          cached: outcome.cached ?? false,
          durationMs: outcome.durationMs,
          model: outcome.model,
          confidence: fb.confidence,
        };
      } else {
        aiFallbackError = outcome.error ?? "AI fallback unavailable.";
      }
    } else {
      aiFallbackError =
        "AI fallback disabled (set PST_AI_FALLBACK=true and OPENROUTER_API_KEY).";
    }
  }

  const a = analysis;
  return {
    severity: a.severity,
    errorTypes: a.errorTypes,
    affectedComponents: a.affectedComponents,
    rootCauses: a.rootCauses,
    rootCausesZh: a.rootCausesZh ?? a.rootCauses,
    immediateInvestigation: a.immediateInvestigation,
    immediateInvestigationZh: a.immediateInvestigationZh ?? a.immediateInvestigation,
    suggestedFixes: a.suggestedFixes,
    suggestedFixesZh: a.suggestedFixesZh ?? a.suggestedFixes,
    longTermImprovements: a.longTermImprovements,
    longTermImprovementsZh: a.longTermImprovementsZh ?? a.longTermImprovements,
    matchedRuleIds: a.matchedRuleIds,
    evidence: a.matchedEvidence,
    skippedRules: a.skippedRules ?? [],
    unknownTriage: a.unknownTriage,
    extracted: {
      timestamps: info.timestamps,
      levels: info.levels,
      components: info.components,
      identifiers: info.identifiers,
      exceptions: info.exceptions,
      sources: info.sources,
      httpStatuses: info.httpStatuses,
      stackTrace: info.stackTrace,
    },
    maskedKeys: masked.maskedKeys,
    logCount: logs.length,
    dossierCount: dossier.length,
    appliedCustomRules: a.matchedRuleIds
      .filter((id) => id.startsWith("custom:"))
      .map((id) => {
        const rule = customRules.find((r) => r.id === id);
        return { id, name: rule?.name ?? id };
      }),
    summary: buildLogSummary(masked.text, customRules),
    analysisSource,
    aiFallbackConfigured: fallbackOptions.enabled,
    aiFallback,
    aiFallbackError,
  };
}

/* ------------------------------------------------------------------ */
/* compare                                                             */
/* ------------------------------------------------------------------ */

export function runCompare(before: string, after: string): ComparisonResult {
  if (typeof before !== "string" || !before.trim()) {
    throw new ToolError("Please provide the 'before' log.");
  }
  if (typeof after !== "string" || !after.trim()) {
    throw new ToolError("Please provide the 'after' log.");
  }
  return compareLogs(before, after);
}

/* ------------------------------------------------------------------ */
/* json toolbox                                                        */
/* ------------------------------------------------------------------ */

export type JsonToolResult = { output: string } | JsonValidationResult | { hits: JsonSearchHit[] };

export interface RunJsonInput {
  input: string;
  action: string;
  query?: string;
}

export function runJson(input: RunJsonInput): JsonToolResult {
  if (typeof input.input !== "string" || !input.input.trim()) {
    throw new ToolError("Please provide JSON input.");
  }
  switch (input.action) {
    case "format":
      return { output: formatJson(input.input) };
    case "minify":
      return { output: minifyJson(input.input) };
    case "validate":
      return validateJson(input.input);
    case "search": {
      const query = typeof input.query === "string" ? input.query : "";
      return { hits: searchJson(input.input, query) };
    }
    default:
      throw new ToolError("Unknown action. Use format, validate, minify or search.");
  }
}

/* ------------------------------------------------------------------ */
/* sql toolbox                                                         */
/* ------------------------------------------------------------------ */

export type SqlToolResult = { output: string } | SqlSafetyResult | SqlAnalysis;

export interface RunSqlInput {
  input: string;
  action: string;
}

export function runSql(input: RunSqlInput): SqlToolResult {
  if (typeof input.input !== "string" || !input.input.trim()) {
    throw new ToolError("Please provide SQL input.");
  }
  switch (input.action) {
    case "format":
      return { output: formatSql(input.input) };
    case "safety":
      return checkSqlSafety(input.input);
    case "analyze":
      return analyzeSql(input.input);
    default:
      throw new ToolError("Unknown action. Use format, safety or analyze.");
  }
}

/* ------------------------------------------------------------------ */
/* timestamp                                                           */
/* ------------------------------------------------------------------ */

export interface RunTimestampInput {
  input: string;
  timezone?: string;
}

export function runTimestamp(input: RunTimestampInput): TimestampResult {
  if (typeof input.input !== "string" || !input.input.trim()) {
    throw new ToolError("Please provide a timestamp.");
  }
  const timezone =
    typeof input.timezone === "string" && input.timezone.trim()
      ? input.timezone.trim()
      : DEFAULT_TIMEZONE;
  const zones = availableTimezones();
  if (!zones.includes(timezone)) {
    throw new ToolError(`Unsupported timezone: ${timezone}`);
  }
  return convertTimestamp(input.input, timezone);
}

/* ------------------------------------------------------------------ */
/* encoding                                                            */
/* ------------------------------------------------------------------ */

export type EncodingToolResult = { output: string };

export interface RunEncodingInput {
  input: string;
  action: string;
}

export function runEncoding(input: RunEncodingInput): EncodingToolResult {
  if (typeof input.input !== "string" || !input.input.trim()) {
    throw new ToolError("Please provide input text.");
  }
  switch (input.action) {
    case "base64-encode":
      return { output: base64Encode(input.input) };
    case "base64-decode":
      return { output: base64Decode(input.input) };
    case "url-encode":
      return { output: urlEncode(input.input) };
    case "url-decode":
      return { output: urlDecode(input.input) };
    case "url-encode-path":
      return { output: urlEncodePath(input.input) };
    default:
      throw new ToolError(
        "Unknown action. Use base64-encode, base64-decode, url-encode, url-decode or url-encode-path.",
      );
  }
}