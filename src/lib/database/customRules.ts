import type { CustomRule, CustomRuleInput, Severity } from "@/types";
import { maxCustomRules, validateCustomRuleInput } from "@/lib/rules/custom";
import { ToolError } from "@/lib/errors";
import { getDb } from "./db";

/**
 * Scoped custom rules repository (Phase 6). Storage is SQLite; validation
 * lives in src/lib/rules/custom.ts (regex compile + caps).
 */

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

function parseJson(value: string, fallback: string[]): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : fallback;
  } catch {
    return fallback;
  }
}

function toCustomRule(row: CustomRuleRow): CustomRule {
  return {
    id: row.id,
    name: row.name,
    scope: {
      type: row.scope_type === "systems" || row.scope_type === "components" ? row.scope_type : "global",
      values: parseJson(row.scope_values, []),
    },
    patterns: parseJson(row.patterns, []),
    severity: row.severity,
    affectedComponents: parseJson(row.affected_components, []),
    rootCauses: parseJson(row.root_causes, []),
    investigation: parseJson(row.investigation, []),
    suggestedFixes: parseJson(row.suggested_fixes, []),
    longTermImprovements: parseJson(row.long_term_improvements, []),
    active: row.active !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listCustomRules(activeOnly = false): CustomRule[] {
  const db = getDb();
  const sql = activeOnly
    ? "SELECT * FROM custom_rules WHERE active = 1 ORDER BY updated_at DESC, id DESC"
    : "SELECT * FROM custom_rules ORDER BY updated_at DESC, id DESC";
  const rows = db.prepare(sql).all() as CustomRuleRow[];
  return rows.map(toCustomRule);
}

export function countActiveCustomRules(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM custom_rules WHERE active = 1")
    .get() as { n: number };
  return row.n;
}

export function getCustomRule(id: number): CustomRule | null {
  const row = getDb().prepare("SELECT * FROM custom_rules WHERE id = ?").get(id) as
    | CustomRuleRow
    | undefined;
  return row ? toCustomRule(row) : null;
}

/** Enforce the total active cap before creating/activating a rule. */
function assertUnderCap(active: boolean) {
  if (!active) return;
  if (countActiveCustomRules() >= maxCustomRules()) {
    throw new ToolError(`Active custom rules limit reached (${maxCustomRules()}).`);
  }
}

export function createCustomRule(raw: Partial<CustomRuleInput>): CustomRule {
  const input = validateCustomRuleInput(raw);
  assertUnderCap(input.active ?? true);
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO custom_rules
       (name, scope_type, scope_values, patterns, severity, affected_components,
        root_causes, investigation, suggested_fixes, long_term_improvements,
        active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name,
      input.scope.type,
      JSON.stringify(input.scope.values),
      JSON.stringify(input.patterns),
      input.severity,
      JSON.stringify(input.affectedComponents),
      JSON.stringify(input.rootCauses),
      JSON.stringify(input.investigation),
      JSON.stringify(input.suggestedFixes),
      JSON.stringify(input.longTermImprovements),
      input.active ? 1 : 0,
      now,
      now,
    );
  return getCustomRule(Number(result.lastInsertRowid))!;
}

export function updateCustomRule(id: number, raw: Partial<CustomRuleInput>): CustomRule | null {
  const existing = getCustomRule(id);
  if (!existing) return null;
  const input = validateCustomRuleInput({ ...existing, ...raw });
  assertUnderCap(input.active ?? true);
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE custom_rules SET
         name = ?, scope_type = ?, scope_values = ?, patterns = ?, severity = ?,
         affected_components = ?, root_causes = ?, investigation = ?,
         suggested_fixes = ?, long_term_improvements = ?, active = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.name,
      input.scope.type,
      JSON.stringify(input.scope.values),
      JSON.stringify(input.patterns),
      input.severity,
      JSON.stringify(input.affectedComponents),
      JSON.stringify(input.rootCauses),
      JSON.stringify(input.investigation),
      JSON.stringify(input.suggestedFixes),
      JSON.stringify(input.longTermImprovements),
      input.active ? 1 : 0,
      new Date().toISOString(),
      id,
    );
  return result.changes > 0 ? getCustomRule(id) : null;
}

export function deleteCustomRule(id: number): boolean {
  const result = getDb().prepare("DELETE FROM custom_rules WHERE id = ?").run(id);
  return result.changes > 0;
}