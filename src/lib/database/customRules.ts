import type { CustomRule, CustomRuleInput, Severity } from "@/types";
import { maxCustomRules, ruleSignature, validateCustomRuleInput } from "@/lib/rules/custom";
import { ToolError } from "@/lib/errors";
import { getDb } from "./db";
import type Database from "better-sqlite3";

/**
 * Scoped custom rules repository (Phase 6). Storage is SQLite; validation
 * lives in src/lib/rules/custom.ts (regex compile + static ReDoS screening
 * + caps). All writes run in IMMEDIATE transactions on the single shared
 * connection, so the active-rule capacity check and the insert it guards can
 * never race (Engineering Review §8).
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

/**
 * Enforce the total active cap (must be called inside the same transaction
 * that adds the active rule so no other write can slip in between).
 */
function assertUnderCap() {
  if (countActiveCustomRules() >= maxCustomRules()) {
    throw new ToolError(`Active custom rules limit reached (${maxCustomRules()}).`);
  }
}

function insertRuleRow(db: Database.Database, input: CustomRuleInput): number {
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
  return Number(result.lastInsertRowid);
}

export function createCustomRule(raw: Partial<CustomRuleInput>): CustomRule {
  const input = validateCustomRuleInput(raw);
  const db = getDb();
  const id = db.transaction(() => {
    if (input.active) assertUnderCap();
    return insertRuleRow(db, input);
  }).immediate();
  return getCustomRule(id)!;
}

/**
 * Update a rule. The active cap is only checked on the `inactive -> active`
 * transition: editing an already-active rule (or deactivating one) must never
 * be blocked just because the cap happens to be full (Engineering Review §8).
 */
export function updateCustomRule(id: number, raw: Partial<CustomRuleInput>): CustomRule | null {
  const db = getDb();
  return db
    .transaction(() => {
      const existing = getCustomRule(id);
      if (!existing) return null;
      const input = validateCustomRuleInput({ ...existing, ...raw });
      if (!existing.active && input.active) {
        assertUnderCap();
      }
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
    })
    .immediate();
}

export function deleteCustomRule(id: number): boolean {
  const result = getDb().prepare("DELETE FROM custom_rules WHERE id = ?").run(id);
  return result.changes > 0;
}

export interface BulkImportResult {
  imported: number;
  skipped: number;
}

/**
 * Import validated rule inputs INSIDE an already-open transaction (shared by
 * the rules import route and the backup-bundle restore). All-or-nothing is
 * guaranteed by the caller's transaction: any throw rolls the whole batch
 * back. Duplicates (scope + name + patterns) are skipped and counted.
 */
export function importCustomRulesInTransaction(
  db: Database.Database,
  inputs: readonly CustomRuleInput[],
): BulkImportResult {
  const existing = new Set(
    (db.prepare("SELECT * FROM custom_rules").all() as CustomRuleRow[]).map(
      (row) => ruleSignature(toCustomRule(row)),
    ),
  );
  const activeCount = db
    .prepare("SELECT COUNT(*) AS n FROM custom_rules WHERE active = 1")
    .get() as { n: number };
  let imported = 0;
  let skipped = 0;
  for (const raw of inputs) {
    const input = validateCustomRuleInput(raw as Partial<CustomRuleInput>);
    const signature = ruleSignature({
      name: input.name,
      scope: input.scope,
      patterns: input.patterns,
    });
    if (existing.has(signature)) {
      skipped += 1;
      continue;
    }
    if (input.active) {
      if (activeCount.n >= maxCustomRules()) {
        throw new ToolError(`Active custom rules limit reached (${maxCustomRules()}).`);
      }
      activeCount.n += 1;
    }
    insertRuleRow(db, input);
    existing.add(signature);
    imported += 1;
  }
  return { imported, skipped };
}

/**
 * Atomic bulk import (Engineering Review §5): validation, duplicate
 * calculation, capacity check and every insert happen inside ONE transaction
 * (IMMEDIATE = the write lock is taken up front). If ANY entry fails — cap
 * exceeded, validation error, SQLite error — the whole batch rolls back and
 * the database is left exactly as it was.
 */
export function bulkImportCustomRules(inputs: readonly CustomRuleInput[]): BulkImportResult {
  const db = getDb();
  return db
    .transaction(() => importCustomRulesInTransaction(db, inputs))
    .immediate();
}