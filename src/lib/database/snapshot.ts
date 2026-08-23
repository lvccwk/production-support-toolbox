import type { CustomRule, HistoryEntry, Incident, Severity } from "@/types";
import type Database from "better-sqlite3";

/**
 * Canonical SQLite row -> domain-object mappers (Engineering Review §6).
 *
 * Single source of truth for how DB rows are serialized into backup bundles:
 * BOTH the daily auto-backup (`backup.ts`) and the manual JSON export
 * (`export.ts`) build their `incidents` / `history` / `customRules` arrays
 * from `readSnapshotRows`, so the two artifacts can never drift apart.
 *
 * This module imports NOTHING from the repositories / db singleton (only
 * types), so backup.ts / export.ts / db.ts can all depend on it without
 * creating import cycles.
 */

export interface IncidentRow {
  id: number;
  title: string;
  system: string;
  environment: string;
  severity: Severity;
  detected_at: string;
  symptoms: string;
  root_cause: string;
  immediate_fix: string;
  permanent_fix: string;
  status: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface HistoryRow {
  id: number;
  created_at: string;
  tool: string;
  system: string;
  summary: string;
  severity: Severity | null;
  payload: string;
}

export interface CustomRuleRow {
  id: number;
  name: string;
  scope_type: string;
  scope_values: string;
  patterns: string;
  severity: Severity;
  affected_components: string;
  root_causes: string;
  investigation: string;
  suggested_fixes: string;
  long_term_improvements: string;
  active: number;
  created_at: string;
  updated_at: string;
}

function parseJson(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

export function mapIncidentRow(row: IncidentRow): Incident {
  return {
    id: row.id,
    title: row.title,
    system: row.system,
    environment: row.environment,
    severity: row.severity,
    detectedAt: row.detected_at,
    symptoms: row.symptoms,
    rootCause: row.root_cause,
    immediateFix: row.immediate_fix,
    permanentFix: row.permanent_fix,
    status: row.status as Incident["status"],
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapHistoryRow(row: HistoryRow): HistoryEntry {
  return {
    id: row.id,
    createdAt: row.created_at,
    tool: row.tool,
    system: row.system,
    summary: row.summary,
    severity: row.severity,
    payload: row.payload,
  };
}

export function mapCustomRuleRow(row: CustomRuleRow): CustomRule {
  const scopeType = row.scope_type === "systems" || row.scope_type === "components"
    ? row.scope_type
    : "global";
  return {
    id: row.id,
    name: row.name,
    scope: {
      type: scopeType,
      values: parseJson(row.scope_values),
    },
    patterns: parseJson(row.patterns),
    severity: row.severity,
    affectedComponents: parseJson(row.affected_components),
    rootCauses: parseJson(row.root_causes),
    investigation: parseJson(row.investigation),
    suggestedFixes: parseJson(row.suggested_fixes),
    longTermImprovements: parseJson(row.long_term_improvements),
    active: row.active !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface SnapshotRows {
  incidents: Incident[];
  history: HistoryEntry[];
  customRules: CustomRule[];
}

/** Read all user data from a connection using the canonical mappers. */
export function readSnapshotRows(database: Database.Database): SnapshotRows {
  const incidents = database.prepare("SELECT * FROM incidents").all() as IncidentRow[];
  const history = database.prepare("SELECT * FROM history").all() as HistoryRow[];
  const customRules = database.prepare("SELECT * FROM custom_rules").all() as CustomRuleRow[];
  return {
    incidents: incidents.map(mapIncidentRow),
    history: history.map(mapHistoryRow),
    customRules: customRules.map(mapCustomRuleRow),
  };
}