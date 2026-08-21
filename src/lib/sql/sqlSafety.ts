import type { SqlSafetyIssue, SqlSafetyResult } from "@/types";
import { ToolError } from "@/lib/errors";
import { splitStatements, stripSqlLiterals } from "./sqlFormatter";

/**
 * SQL safety checker (section 9): flags DELETE, DROP, TRUNCATE and
 * UPDATE/DELETE missing a WHERE clause. Text-only — never executes SQL.
 */

function dangerousStatementCheck(statement: string): SqlSafetyIssue | null {
  const stripped = stripSqlLiterals(statement);

  if (/\bDROP\s+(TABLE|DATABASE|INDEX|VIEW|SCHEMA)\b/i.test(stripped)) {
    return {
      severity: "critical",
      code: "DROP_STATEMENT",
      message: "This DROP statement permanently removes database objects.",
      statement,
    };
  }
  if (/\bTRUNCATE\b/i.test(stripped)) {
    return {
      severity: "critical",
      code: "TRUNCATE_STATEMENT",
      message: "This TRUNCATE statement removes all rows from the table.",
      statement,
    };
  }
  if (/\bUPDATE\b/i.test(stripped) && !/\bWHERE\b/i.test(stripped)) {
    return {
      severity: "critical",
      code: "UPDATE_WITHOUT_WHERE",
      message:
        "This UPDATE statement does not contain a WHERE clause. It may update all rows.",
      statement,
    };
  }
  if (/\bDELETE\s+FROM\b/i.test(stripped) && !/\bWHERE\b/i.test(stripped)) {
    return {
      severity: "critical",
      code: "DELETE_WITHOUT_WHERE",
      message:
        "This DELETE statement does not contain a WHERE clause. It may delete all rows.",
      statement,
    };
  }
  if (/\bALTER\s+(TABLE|DATABASE|INDEX|VIEW)\b/i.test(stripped)) {
    return {
      severity: "warning",
      code: "ALTER_STATEMENT",
      message: "This ALTER statement changes the schema. Review it before running.",
      statement,
    };
  }
  if (/\bCREATE\s+(TABLE|INDEX)\b/i.test(stripped) && /IF\s+NOT\s+EXISTS/i.test(stripped) === false) {
    // CREATE is an informational note (may fail if object exists).
    return {
      severity: "info",
      code: "CREATE_STATEMENT",
      message: "This CREATE statement creates a new database object.",
      statement,
    };
  }
  return null;
}

/** Check a full SQL script and return all findings per statement. */
export function checkSqlSafety(sql: string): SqlSafetyResult {
  const trimmed = sql.trim();
  if (!trimmed) {
    throw new ToolError("Empty input. Paste SQL before checking.");
  }
  const statements = splitStatements(trimmed);
  const issues: SqlSafetyIssue[] = [];
  for (const statement of statements) {
    const issue = dangerousStatementCheck(statement);
    if (issue) issues.push(issue);
  }
  return { issues, safe: issues.length === 0 };
}