import type { SqlAnalysis, SqlStatementType } from "@/types";
import { ToolError } from "@/lib/errors";
import { stripSqlLiterals } from "./sqlFormatter";

/**
 * Basic SQL analysis (section 9): statement type, tables, WHERE, JOIN,
 * ORDER BY / GROUP BY and bind-parameter count. Pure text analysis.
 */

const TABLE_NAME_RE = /[`"\[]?([A-Za-z_][A-Za-z0-9_$]*)[`"\]]?/;

function matchTables(source: string, keyword: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\b${keyword}\\s+${TABLE_NAME_RE.source}`, "gi");
  for (const m of source.matchAll(re)) {
    out.push(m[1]);
  }
  return out;
}

function listAfterKeyword(source: string, keyword: string): string[] {
  const re = new RegExp(`\\b${keyword}\\s+([^;]+)`, "i");
  const m = source.match(re);
  if (!m) return [];
  // The captured tail may run into the next clause (e.g. ... LIMIT 10).
  const tail = m[1].split(
    /\s+(?:ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET|UNION|UNION\s+ALL)\b/i,
  )[0];
  return tail
    .split(",")
    .map((part) => part.replace(/\b(ASC|DESC)\b/gi, "").trim())
    .filter((part) => /^[A-Za-z_][A-Za-z0-9_.$]*$/.test(part) && part.length > 0);
}

function detectStatementType(stripped: string): SqlStatementType {
  if (/\bSELECT\b/i.test(stripped)) return "SELECT";
  if (/\bINSERT\s+INTO\b/i.test(stripped)) return "INSERT";
  if (/\bUPDATE\b/i.test(stripped)) return "UPDATE";
  if (/\bDELETE\s+FROM\b/i.test(stripped)) return "DELETE";
  if (/\bCREATE\s+(TABLE|VIEW|INDEX|DATABASE|SCHEMA)\b/i.test(stripped)) return "CREATE";
  if (/\bALTER\s+(TABLE|VIEW|INDEX|DATABASE|SCHEMA)\b/i.test(stripped)) return "ALTER";
  if (/\bDROP\s+(TABLE|VIEW|INDEX|DATABASE|SCHEMA)\b/i.test(stripped)) return "DROP";
  if (/\bTRUNCATE\b/i.test(stripped)) return "TRUNCATE";
  return "UNKNOWN";
}

/** Analyse one SQL script (may contain multiple statements). */
export function analyzeSql(sql: string): SqlAnalysis {
  const trimmed = sql.trim();
  if (!trimmed) {
    throw new ToolError("Empty input. Paste SQL before analysis.");
  }
  const stripped = stripSqlLiterals(trimmed).replace(/\s*([(),.;=<>])\s*/g, "$1");

  const tables = new Set<string>();
  for (const keyword of ["FROM", "JOIN", "UPDATE", "INTO", "TABLE"]) {
    for (const table of matchTables(stripped, keyword)) {
      // skip column-like aliases: a FROM followed by an identifier is a table
      tables.add(table);
    }
  }

  const joins: string[] = [];
  const joinRe = /\b((?:LEFT|RIGHT|FULL|INNER|OUTER|CROSS)\s+)?JOIN\b/gi;
  for (const m of stripped.matchAll(joinRe)) {
    joins.push((m[1] ?? "").trim().toUpperCase() + "JOIN");
  }

  return {
    statementType: detectStatementType(stripped),
    tables: [...tables],
    hasWhere: /\bWHERE\b/i.test(stripped) && /\b(?:SELECT|UPDATE|DELETE)\b/i.test(stripped),
    joins,
    orderBy: listAfterKeyword(stripped, "ORDER\\s+BY").map((s) => s.replace(/\s+/g, " ")),
    groupBy: listAfterKeyword(stripped, "GROUP\\s+BY"),
    hasLimit: /\bLIMIT\b/i.test(stripped),
    parameterCount: (stripped.match(/\?/g) ?? []).length,
  };
}