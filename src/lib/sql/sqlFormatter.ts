import { ToolError } from "@/lib/errors";

/**
 * Lightweight deterministic SQL formatter (section 9). No external parser:
 * tokenises while preserving quoted strings and comments, uppercases
 * keywords and breaks lines at major clauses. Kept intentionally simple.
 */

type SqlToken = {
  text: string;
  type: "word" | "quoted" | "number" | "punct" | "comment";
};

const CLAUSE_KEYWORDS = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP BY",
  "HAVING",
  "ORDER BY",
  "LIMIT",
  "OFFSET",
  "UNION",
  "UNION ALL",
  "VALUES",
  "SET",
  "INSERT",
  "INSERT INTO",
  "UPDATE",
  "DELETE",
  "DELETE FROM",
  "CREATE",
  "CREATE TABLE",
  "ALTER",
  "ALTER TABLE",
  "DROP",
  "DROP TABLE",
  "TRUNCATE",
  "TRUNCATE TABLE",
  "WITH",
  "JOIN",
  "INNER JOIN",
  "LEFT JOIN",
  "LEFT OUTER JOIN",
  "RIGHT JOIN",
  "RIGHT OUTER JOIN",
  "FULL JOIN",
  "FULL OUTER JOIN",
  "CROSS JOIN",
  "ON",
]);

const DIRECTION_WORDS = new Set(["LEFT", "RIGHT", "FULL", "INNER", "OUTER", "CROSS"]);
const JOIN_WORD = "JOIN";

const TOKEN_RE =
  /('(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|--[^\r\n]*|\/\*[\s\S]*?\*\/)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_$]*)|(.)/g;

export function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  for (const m of sql.matchAll(TOKEN_RE)) {
    if (m[0].length === 0) continue;
    // Skip plain whitespace between tokens (formatting-only).
    if (/^\s+$/.test(m[0])) continue;
    let type: SqlToken["type"] = "word";
    if (m[1] !== undefined) type = m[1].startsWith("--") || m[1].startsWith("/*") ? "comment" : "quoted";
    else if (m[2] !== undefined) type = "number";
    else if (m[3] !== undefined) type = "word";
    else type = "punct";
    tokens.push({ text: m[0], type });
  }
  return tokens;
}

function isClauseKeyword(word: string): boolean {
  return CLAUSE_KEYWORDS.has(word.toUpperCase());
}

/** True when a keyword looks like a clause boundary (first token of a clause). */
function isClauseBoundary(prevText: string | null, word: string, depth: number, inWhere: boolean): boolean {
  const upper = word.toUpperCase();
  if (depth > 0) {
    // Inside parentheses we only break before subquery SELECT.
    return upper === "SELECT";
  }
  if (DIRECTION_WORDS.has(upper) || upper === JOIN_WORD) return false; // handled as LEFT JOIN pairs
  if (isClauseKeyword(upper)) return true;
  if ((upper === "AND" || upper === "OR") && inWhere) return true;
  if (upper === "ON" && prevText !== null && /\bJOIN$/i.test(prevText)) return true;
  return false;
}

function isDirJoinPair(a: string, b: string): boolean {
  return DIRECTION_WORDS.has(a.toUpperCase()) && b.toUpperCase() === "JOIN";
}

/**
 * Format SQL text into readable, indented form. Throws ToolError on empty
 * input; never corrupts string literals or comments.
 */
export function formatSql(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) {
    throw new ToolError("Empty input. Paste SQL before formatting.");
  }
  const tokens = tokenizeSql(trimmed);

  const lines: string[] = [];
  let line = "";
  let depth = 0;
  let inWhere = false;
  let prevWord: string | null = null;

  const flush = (): void => {
    if (line.trim().length > 0) {
      lines.push(line.trimEnd());
    }
    line = "";
  };

  const emit = (text: string): void => {
    if (line.length === 0) {
      line = "  ".repeat(depth);
    } else if (text === ")" || text === "(" || text === ".") {
      line += text; // attach without a leading space
      return;
    } else if (line.endsWith("(") || line.endsWith(".") || line.endsWith(")")) {
      line += text; // no space after opening paren / dot
      return;
    } else if (text === "," || text === ";") {
      line += text; // no space before comma / semicolon
      return;
    } else {
      line += " ";
    }
    line += text;
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const isWord = token.type === "word";

    if (token.type === "comment") {
      flush();
      lines.push(token.text.trim());
      continue;
    }
    if (token.type === "quoted" || token.type === "number") {
      emit(token.text);
      continue;
    }

    const text = token.text;

    if (text === "(") {
      // Subquery parens get special formatting: break before when followed by SELECT.
      const nextWord = tokens[i + 1]?.text.toUpperCase();
      const isSubquery = nextWord === "SELECT";
      if (isSubquery) flush();
      depth += 1;
      emit(isSubquery ? "(" : "(");
      if (isSubquery) flush();
      continue;
    }
    if (text === ")") {
      depth = Math.max(0, depth - 1);
      emit(")");
      if (tokens[i + 1] && tokens[i + 1].text === ",") {
        // continue, comma handled next
      }
      continue;
    }
    if (text === ",") {
      emit(",");
      // Wrap long SELECT lists / multi-column clauses; keep short ones inline.
      if (depth === 0 && line.length > 60) flush();
      continue;
    }
    if (text === ";") {
      emit(";");
      flush();
      continue;
    }

    if (isWord) {
      const upper = text.toUpperCase();
      const next = tokens[i + 1];
      const isMulti = isDirJoinPair(text, next?.text ?? "");

      if (upper === "WHERE") inWhere = true;
      if (upper === "FROM" || upper === "HAVING") inWhere = false;

      if (isClauseBoundary(prevWord, isMulti ? `${text} ${next?.text ?? ""}` : text, depth, inWhere)) {
        flush();
      }
      emit(isMulti ? `${text.toUpperCase()} ${next!.text.toUpperCase()}` : text.toUpperCase());
      if (isMulti) i += 1; // consume the JOIN word
      prevWord = isMulti ? `${text} ${next!.text}` : text;
      continue;
    }

    emit(text);
    prevWord = null;
  }
  flush();

  const result = lines.join("\n");
  return result.length > 0 ? result : trimmed;
}

/** Split a SQL script into statements on top-level semicolons. */
export function splitStatements(sql: string): string[] {
  const tokens = tokenizeSql(sql);
  const statements: string[] = [];
  let current = "";
  let depth = 0;
  for (const token of tokens) {
    if (token.type === "comment") continue;
    // Rebuild spacing: attach "," ")" without a leading space; "(" attaches
    // to its opener word only when not preceded by whitespace in practice.
    const attachNoSpace =
      token.type === "punct" && (token.text === ")" || token.text === ",");
    if (!attachNoSpace && current.length > 0) current += " ";
    if (token.text === "(") depth += 1;
    if (token.text === ")") depth = Math.max(0, depth - 1);
    if (token.text === ";" && depth === 0) {
      if (current.trim()) statements.push(current.trim());
      current = "";
      continue;
    }
    current += token.text;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

/** Remove string literals and comments so keyword analysis is not fooled. */
export function stripSqlLiterals(sql: string): string {
  const tokens = tokenizeSql(sql);
  return tokens
    .filter((t) => t.type !== "quoted" && t.type !== "comment")
    .map((t) => t.text)
    .join(" ");
}