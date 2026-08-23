import type {
  HistoryEntry,
  HistoryInput,
  Incident,
  IncidentInput,
  CustomRule,
  CustomRuleInput,
  Severity,
  UnknownTriage,
} from "@/types";
import { ToolError } from "@/lib/errors";
import { getDb } from "./db";
import { BACKUP_SCHEMA_VERSION } from "./backup";
import { readSnapshotRows } from "./snapshot";
import { importCustomRulesInTransaction } from "./customRules";
import { extractLogInfo } from "@/lib/log-parser/parser";
import { detectSensitiveData } from "@/lib/sensitive/detector";
import { createIncident, validateIncidentInput } from "./incidents";
import { createHistoryEntry, validateHistoryInput } from "./history";

/**
 * Export / import for incidents, support history and custom rules
 * (Engineering Review §6).
 *
 * Exports are full snapshots as JSON (schema-versioned, v2 = incidents +
 * history + customRules) or per-kind CSV. The daily auto-backup and the
 * manual JSON export BOTH go through the canonical mappers (snapshot.ts), so
 * the two artifacts can never drift apart. Imports restore with duplicate
 * protection and are all-or-nothing (single transaction):
 *   - history entries dedupe on (tool + created_at + payload) hash,
 *   - incidents dedupe on a content hash of all user-editable fields
 *     (ids are NOT used — they are not stable across machines),
 *   - custom rules dedupe on (scope + name + patterns) signature.
 */

/** Old schema-v1 backup shape: no customRules (still importable). */
export type BackupSchemaVersion = 1 | 2;

export interface BackupBundle {
  schemaVersion: number;
  exportedAt: string;
  incidents: Incident[];
  history: HistoryExportEntry[];
  customRules: CustomRule[];
}

/** One bilingual (zh/en aligned) analysis bullet — CSV cells and JSON both. */
export interface AnalysisPair {
  zh: string | null;
  en: string;
}

/**
 * Structured analysis of a log-analyzer history entry, parsed OUT of the
 * stored payload so exports can break the analysis result into fields
 * (severity, matched rule count, error types, root cause, investigation,
 * suggested fix, long-term improvement) without parsing payload JSON by hand.
 * The AI fallback (when analysisSource was "ai-fallback") takes precedence.
 */
export interface ParsedHistoryAnalysis {
  source: "rules" | "ai-fallback" | null;
  severity: Severity | null;
  matchedRuleCount: number | null;
  errorTypes: string[];
  affectedComponents: string[];
  possibleRootCause: AnalysisPair[];
  immediateInvestigation: AnalysisPair[];
  suggestedFixes: AnalysisPair[];
  longTermImprovements: AnalysisPair[];
  unknownTriage: UnknownTriage | null;
  aiFallback: {
    severity: Severity | null;
    model: string | null;
    confidence: number | null;
    cached: boolean | null;
  } | null;
}

/** History entry as exported to JSON: analysis available at its own field. */
export type HistoryExportEntry = HistoryEntry & {
  analysis: ParsedHistoryAnalysis | null;
};

export interface ImportResult {
  importedIncidents: number;
  importedHistory: number;
  importedRules: number;
  skipped: number;
  skippedRules: number;
}

/**
 * Full snapshot of every user table. History rows are enriched with a parsed
 * `analysis` object (additive — the canonical fields stay identical to the
 * daily auto-backup so restores are compatible with either artifact).
 */
export function exportAllData(): BackupBundle {
  const { incidents, history, customRules } = readSnapshotRows(getDb());
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    incidents,
    history: history.map((entry) => ({
      ...entry,
      analysis: parseHistoryAnalysis(entry),
    })),
    customRules,
  };
}

export function bundleToJson(bundle: BackupBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/** Stable non-cryptographic content hash (djb2) for duplicate detection. */
function contentHash(fields: string[]): string {
  let hash = 5381;
  for (const field of fields) {
    for (let i = 0; i < field.length; i++) {
      hash = ((hash << 5) + hash + field.charCodeAt(i)) >>> 0;
    }
    hash = ((hash << 5) + hash + 0x2c) >>> 0; // separator
  }
  return hash.toString(36);
}

function incidentContentHash(input: IncidentInput): string {
  return contentHash([
    input.title,
    input.system,
    input.environment,
    input.severity,
    input.detectedAt,
    input.symptoms,
    input.rootCause,
    input.immediateFix,
    input.permanentFix,
    input.status,
    input.notes,
  ]);
}

function historyContentHash(tool: string, createdAt: string, payload: string): string {
  return contentHash([tool, createdAt, payload]);
}

interface ExistingHashes {
  incidents: Set<string>;
  history: Set<string>;
}

function loadExistingHashes(): ExistingHashes {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT title, system, environment, severity, detected_at, symptoms,
              root_cause, immediate_fix, permanent_fix, status, notes
       FROM incidents`,
    )
    .all() as Array<Record<string, string>>;
  const incidents = new Set(
    rows.map((r) =>
      contentHash([
        r.title,
        r.system,
        r.environment,
        r.severity,
        r.detected_at,
        r.symptoms,
        r.root_cause,
        r.immediate_fix,
        r.permanent_fix,
        r.status,
        r.notes,
      ]),
    ),
  );
  const historyRows = db
    .prepare("SELECT tool, created_at, payload FROM history")
    .all() as Array<{ tool: string; created_at: string; payload: string }>;
  const history = new Set(
    historyRows.map((r) => historyContentHash(r.tool, r.created_at, r.payload)),
  );
  return { incidents, history };
}

/**
 * Import a backup JSON bundle (schema v1 or v2) — all-or-nothing across
 * incidents, history AND custom rules. Entries already present (by dedupe
 * key) are skipped; ANY invalid entry or capacity violation rolls the whole
 * bundle back.
 */
export function importBundleJson(json: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ToolError("Invalid backup JSON.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ToolError("Invalid backup format.");
  }
  const bundle = parsed as Partial<BackupBundle>;
  if (bundle.schemaVersion !== 1 && bundle.schemaVersion !== 2) {
    throw new ToolError(
      `Unsupported backup schema version: ${String(bundle.schemaVersion)} (expected 1 or 2).`,
    );
  }
  if (!Array.isArray(bundle.incidents) || !Array.isArray(bundle.history)) {
    throw new ToolError("Invalid backup format (incidents/history missing).");
  }
  // Capture outside the transaction closure so type narrowing survives.
  const bundledIncidents = bundle.incidents;
  const bundledHistory = bundle.history;
  const bundledRules = Array.isArray(bundle.customRules) ? bundle.customRules : [];

  const db = getDb();
  return db.transaction(() => {
    const existing = loadExistingHashes();
    let importedIncidents = 0;
    let importedHistory = 0;
    let skipped = 0;

    for (const raw of bundledIncidents) {
      const input = validateIncidentInput(raw as Partial<IncidentInput>);
      const hash = incidentContentHash(input);
      if (existing.incidents.has(hash)) {
        skipped += 1;
        continue;
      }
      createIncident(input);
      existing.incidents.add(hash);
      importedIncidents += 1;
    }

    for (const raw of bundledHistory) {
      const entry = raw as Partial<HistoryEntry>;
      const input = validateHistoryInput(entry as Partial<HistoryInput>);
      const createdAt = typeof entry.createdAt === "string" ? entry.createdAt : "";
      const hash = historyContentHash(input.tool, createdAt, input.payload);
      if (existing.history.has(hash)) {
        skipped += 1;
        continue;
      }
      createHistoryEntry(input, { createdAt });
      existing.history.add(hash);
      importedHistory += 1;
    }

    const rulesResult = importCustomRulesInTransaction(
      db,
      bundledRules as CustomRuleInput[],
    );

    return {
      importedIncidents,
      importedHistory,
      importedRules: rulesResult.imported,
      skipped,
      skippedRules: rulesResult.skipped,
    };
  })();
}

// ---------------------------------------------------------------------------
// CSV export (flat, Excel-friendly: BOM prefix, CRLF rows, quoted fields).
// Spreadsheet-safe: formula injection prefixes are neutralized (see below).
// ---------------------------------------------------------------------------

/**
 * Spreadsheet formula injection sanitizer (Engineering Review §7).
 *
 * Excel / LibreOffice treat a cell as a formula when its content starts with
 * `=`, `+`, `-` or `@` — possibly hidden behind leading whitespace, tabs or
 * control characters. Prefixing such cells with `'` forces them to be shown
 * as literal text. Everything else passes through untouched, so quotes,
 * commas, Unicode, multiline fields and numeric/controlled-enum columns
 * round-trip exactly as before.
 */
const FORMULA_TRIGGER = /^[\s\u0000-\u001f]*[=+\-@]/;

function csvSafeCell(value: unknown): string {
  const text = String(value ?? "");
  return FORMULA_TRIGGER.test(text) ? `'${text}` : text;
}

function csvEscape(value: unknown): string {
  return `"${csvSafeCell(value).replace(/"/g, '""')}"`;
}

export function incidentsToCsv(incidents: Incident[]): string {
  const header = [
    "id", "title", "system", "environment", "severity", "detectedAt",
    "symptoms", "rootCause", "immediateFix", "permanentFix", "status",
    "notes", "createdAt", "updatedAt",
  ];
  const rows = incidents.map((i) =>
    [
      i.id, i.title, i.system, i.environment, i.severity, i.detectedAt,
      i.symptoms, i.rootCause, i.immediateFix, i.permanentFix, i.status,
      i.notes, i.createdAt, i.updatedAt,
    ]
      .map(csvEscape)
      .join(","),
  );
  return `\uFEFF${[header.map(csvEscape).join(","), ...rows].join("\r\n")}`;
}

/**
 * Derived metadata for one history entry — pulls useful info out of the
 * stored payload so CSV exports don't force you to open every JSON payload.
 * Analysis columns (analysisSource … longTermImprovements) are empty for
 * non-log tools and for entries saved before the analysis snapshot existed.
 */
export interface HistoryCsvMeta {
  inputPreview: string;
  inputChars: number;
  detail: string;
  sensitive: string; // "yes" | ""
  analysisSource: string;
  matchedRuleCount: string;
  errorTypes: string;
  affectedComponents: string;
  possibleRootCause: string;
  immediateInvestigation: string;
  suggestedFixes: string;
  longTermImprovements: string;
}

function safePayload(entry: HistoryEntry): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(entry.payload);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const SEVERITIES: Severity[] = ["Critical", "High", "Medium", "Low", "Informational"];

function isSeverity(value: unknown): value is Severity {
  return typeof value === "string" && (SEVERITIES as string[]).includes(value);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Zip the stored zh/en arrays into aligned pairs (en is the source of truth). */
function analysisPairs(zh: unknown, en: unknown): AnalysisPair[] {
  const enList = asStringArray(en);
  const zhList = asStringArray(zh);
  return enList.map((text, i) => ({ zh: zhList[i] ?? null, en: text }));
}

/** Render pairs into a single CSV cell, e.g. "zh — en | zh2 — en2". */
function pairsToCell(pairs: AnalysisPair[], numbered = false): string {
  return pairs
    .map((p, i) => {
      const prefix = numbered ? `${i + 1}. ` : "";
      return p.zh !== null && p.zh !== p.en ? `${prefix}${p.zh} — ${p.en}` : `${prefix}${p.en}`;
    })
    .join(" | ");
}

/**
 * Parse the analysis stored by the Log Analyzer GUI (or an agent) out of the
 * payload. Returns null for non-log tools, legacy entries and unreadable
 * payloads. When analysisSource === "ai-fallback" the AI result wins for the
 * analysis fields; component/rule info still comes from the rule engine.
 */
export function parseHistoryAnalysis(entry: HistoryEntry): ParsedHistoryAnalysis | null {
  const payload = safePayload(entry);
  const analysis = asObject(payload.analysis);
  if (!analysis) return null;
  const ai = payload.analysisSource === "ai-fallback" ? asObject(payload.aiFallback) : null;

  const errorTypes = asStringArray(ai ? ai.errorTypes : analysis.errorTypes);
  const source: "rules" | "ai-fallback" | null = ai ? "ai-fallback" : "rules";
  const ruleSeverity = isSeverity(analysis.severity) ? analysis.severity : null;
  const aiSeverity = ai && isSeverity(ai.severity) ? ai.severity : null;

  return {
    source,
    severity: aiSeverity ?? ruleSeverity,
    matchedRuleCount: Array.isArray(analysis.matchedRuleIds)
      ? analysis.matchedRuleIds.length
      : null,
    errorTypes,
    affectedComponents: asStringArray(analysis.affectedComponents),
    possibleRootCause: analysisPairs(
      ai ? ai.rootCausesZh : analysis.rootCausesZh,
      ai ? ai.rootCauses : analysis.rootCauses,
    ),
    immediateInvestigation: analysisPairs(
      ai ? ai.immediateInvestigationZh : analysis.immediateInvestigationZh,
      ai ? ai.immediateInvestigation : analysis.immediateInvestigation,
    ),
    suggestedFixes: analysisPairs(
      ai ? ai.suggestedFixesZh : analysis.suggestedFixesZh,
      ai ? ai.suggestedFixes : analysis.suggestedFixes,
    ),
    longTermImprovements: analysisPairs(
      ai ? ai.longTermImprovementsZh : analysis.longTermImprovementsZh,
      ai ? ai.longTermImprovements : analysis.longTermImprovements,
    ),
    unknownTriage: (asObject(analysis.unknownTriage) as UnknownTriage | null) ?? null,
    aiFallback: ai
      ? {
          severity: aiSeverity,
          model: str(ai.model) || null,
          confidence: asNumber(ai.confidence),
          cached: typeof ai.cached === "boolean" ? ai.cached : null,
        }
      : null,
  };
}

/** Extract structured info for the log-* tools using the parser. */
function logDetail(input: string): string {
  const info = extractLogInfo(input);
  const parts: string[] = [];
  const exception = info.exceptions[0];
  if (exception) parts.push(exception);
  const component = info.components[0];
  if (component) parts.push(component);
  if (info.httpStatuses.length > 0) {
    parts.push(`HTTP ${info.httpStatuses.join(",")}`);
  }
  return parts.join(" · ");
}

export function historyCsvMeta(entry: HistoryEntry): HistoryCsvMeta {
  const payload = safePayload(entry);
  const input = (str(payload.input) || str(payload.before) || entry.payload).trim();

  let detail = "";
  switch (entry.tool) {
    case "log-analyzer":
      detail = logDetail(input);
      break;
    case "log-comparison": {
      const before = str(payload.before).length;
      const after = str(payload.after).length;
      detail = `before:${before} after:${after} chars`;
      break;
    }
    case "json":
    case "sql":
    case "encoding":
      detail = str(payload.mode || payload.action || payload.operation);
      break;
    case "timestamp":
      detail = str(payload.timezone) || "Asia/Hong_Kong";
      break;
    case "cron":
      detail = str(payload.input);
      break;
    default:
      detail = "";
  }

  const sensitive = detectSensitiveData(entry.payload).found ? "yes" : "";

  const analysis = parseHistoryAnalysis(entry);

  return {
    inputPreview: input.replace(/\s+/g, " ").slice(0, 200),
    inputChars: input.length,
    detail,
    sensitive,
    analysisSource: analysis?.source ?? "",
    matchedRuleCount: analysis?.matchedRuleCount != null ? String(analysis.matchedRuleCount) : "",
    errorTypes: analysis ? analysis.errorTypes.join(" | ") : "",
    affectedComponents: analysis ? analysis.affectedComponents.join(" | ") : "",
    possibleRootCause: analysis ? pairsToCell(analysis.possibleRootCause) : "",
    immediateInvestigation: analysis ? pairsToCell(analysis.immediateInvestigation, true) : "",
    suggestedFixes: analysis ? pairsToCell(analysis.suggestedFixes) : "",
    longTermImprovements: analysis ? pairsToCell(analysis.longTermImprovements) : "",
  };
}

export function historyToCsv(entries: HistoryEntry[]): string {
  const header = [
    "id", "createdAt", "tool", "system", "summary", "severity",
    "analysisSource", "matchedRuleCount", "errorTypes", "affectedComponents",
    "possibleRootCause", "immediateInvestigation", "suggestedFixes",
    "longTermImprovements", "inputChars", "inputPreview", "detail", "sensitive",
    "payload",
  ];
  const rows = entries.map((e) => {
    const meta = historyCsvMeta(e);
    return [
      e.id, e.createdAt, e.tool, e.system, e.summary, e.severity ?? "",
      meta.analysisSource, meta.matchedRuleCount, meta.errorTypes,
      meta.affectedComponents, meta.possibleRootCause, meta.immediateInvestigation,
      meta.suggestedFixes, meta.longTermImprovements,
      meta.inputChars, meta.inputPreview, meta.detail, meta.sensitive,
      e.payload,
    ]
      .map(csvEscape)
      .join(",");
  });
  return `\uFEFF${[header.map(csvEscape).join(","), ...rows].join("\r\n")}`;
}