import type { HistoryEntry, HistoryInput, Severity } from "@/types";
import { ToolError } from "@/lib/errors";
import { getDb } from "./db";

/**
 * Support history repository (section 15). Entries are only written when the
 * user explicitly clicks "Save Analysis"; nothing is stored automatically.
 */

export interface HistoryRow {
  id: number;
  created_at: string;
  tool: string;
  system: string;
  summary: string;
  severity: Severity | null;
  payload: string;
}

function toHistoryEntry(row: HistoryRow): HistoryEntry {
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

const KNOWN_TOOLS = [
  "log-analyzer",
  "log-comparison",
  "json",
  "sql",
  "timestamp",
  "http",
  "encoding",
  "cron",
];

/** Validate a history entry before storing it. */
export function validateHistoryInput(raw: Partial<HistoryInput>): HistoryInput {
  const tool = typeof raw.tool === "string" ? raw.tool.trim() : "";
  if (!KNOWN_TOOLS.includes(tool)) {
    throw new ToolError("Unknown tool.");
  }
  const system = typeof raw.system === "string" ? raw.system.trim().slice(0, 100) : "";
  const summary = typeof raw.summary === "string" ? raw.summary.trim().slice(0, 500) : "";
  if (!summary) throw new ToolError("Summary is required.");

  let severity: Severity | null = null;
  if (raw.severity !== undefined && raw.severity !== null) {
    const candidate = raw.severity as string;
    if (!["Critical", "High", "Medium", "Low", "Informational"].includes(candidate)) {
      throw new ToolError("Invalid severity.");
    }
    severity = candidate as Severity;
  }

  const payload = typeof raw.payload === "string" ? raw.payload : "";
  if (payload.length > 200_000) {
    throw new ToolError("Payload too large.");
  }

  return { tool, system, summary, severity, payload };
}

export function listHistory(query?: string): HistoryEntry[] {
  const db = getDb();
  if (query && query.trim()) {
    const like = `%${query.trim()}%`;
    const rows = db
      .prepare(
        `SELECT * FROM history
         WHERE tool LIKE ? OR system LIKE ? OR summary LIKE ? OR payload LIKE ?
         ORDER BY created_at DESC, id DESC`,
      )
      .all(like, like, like, like) as HistoryRow[];
    return rows.map(toHistoryEntry);
  }
  const rows = db
    .prepare("SELECT * FROM history ORDER BY created_at DESC, id DESC")
    .all() as HistoryRow[];
  return rows.map(toHistoryEntry);
}

export function getHistoryEntry(id: number): HistoryEntry | null {
  const row = getDb().prepare("SELECT * FROM history WHERE id = ?").get(id) as
    | HistoryRow
    | undefined;
  return row ? toHistoryEntry(row) : null;
}

export function createHistoryEntry(
  input: HistoryInput,
  opts?: { createdAt?: string },
): HistoryEntry {
  const db = getDb();
  // Imports preserve the original created_at so dedupe hashes stay stable.
  const createdAt = opts?.createdAt ?? new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO history (created_at, tool, system, summary, severity, payload)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(createdAt, input.tool, input.system, input.summary, input.severity, input.payload);
  return getHistoryEntry(Number(result.lastInsertRowid))!;
}

export function deleteHistoryEntry(id: number): boolean {
  const result = getDb().prepare("DELETE FROM history WHERE id = ?").run(id);
  return result.changes > 0;
}