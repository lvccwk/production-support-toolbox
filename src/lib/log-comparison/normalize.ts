/**
 * Line-level token masking (Phase 1 de-noising). Before two logs are diffed,
 * volatile tokens — timestamps, request/trace identifiers, IPs, URLs, raw
 * numbers — are replaced with stable placeholders so that LCS diff and error
 * clustering only see *semantic* changes, not noise that changes on every
 * run. Pure functions; every replacement is idempotent.
 *
 * Placeholders:
 *   [TS]  timestamps            [ID]  identifiers / long hex / UUIDs
 *   [IP]  IPv4 (+ optional port)[URL] http(s) URLs
 *   [SC]  HTTP status codes     [PCT] percentages
 *   [N]   other numbers
 */

const TIMESTAMP_RE =
  /\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?\b/g;

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

const LONG_HEX_RE = /\b[0-9a-f]{16,}\b/gi;

/** Known identifier fields: `transactionId=ABC123` → `transactionId=[ID]`. */
const IDENTIFIER_VALUE_RE =
  /\b(transactionId|transaction_id|requestId|request_id|traceId|trace_id|correlationId|correlation_id|sessionId|session_id|userId|user_id|orderId|order_id|jobId|job_id|taskId|task_id|refId|ref_id|recordId|record_id|messageId|message_id)\s*[=:]\s*"?[A-Za-z0-9_.\-/:=]+"?/gi;

const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/gi;

const HTTP_STATUS_RE =
  /\b(?:HTTP[/\s]+|HTTP\/[\d.]+[\s:]+|status\s*[=:]\s*|statusCode\s*[=:]\s*|status_code\s*[=:]\s*|http_status\s*[=:]\s*)([1-5]\d\d)\b/gi;

const IP_RE = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g;

const PERCENT_RE = /\b\d+(?:\.\d+)?%/g;

/** Durations: `1234ms`, `30s`, `2.5sec` → [DUR] (high-frequency noise). */
const DURATION_RE = /\b\d+(?:\.\d+)?\s*(?:ms|msec|sec|s|μs|us|ns)\b/gi;

/** Plain standalone numbers; numbers glued to words or inside dotted versions stay. */
const NUMBER_RE = /(?<![\w.])\d+(?![\w.%])/g;

function maskHttpStatus(text: string): string {
  return text.replace(
    HTTP_STATUS_RE,
    (match, code: string) => match.replace(code, "[SC]"),
  );
}

function maskIdentifiers(text: string): string {
  return text.replace(IDENTIFIER_VALUE_RE, (match, key: string) => {
    // `transactionId = ABC123` keeps the key, replaces the value.
    return `${key}=[ID]`;
  });
}

/** Mask one log line. Idempotent: normalising an already-normalised line is a no-op. */
export function normalizeLine(line: string): string {
  let out = line.trim();
  out = out.replace(URL_RE, "[URL]");
  out = maskHttpStatus(out);
  out = out.replace(TIMESTAMP_RE, "[TS]");
  out = out.replace(UUID_RE, "[ID]");
  out = out.replace(LONG_HEX_RE, "[ID]");
  out = maskIdentifiers(out);
  out = out.replace(IP_RE, "[IP]");
  out = out.replace(PERCENT_RE, "[PCT]");
  out = out.replace(DURATION_RE, "[DUR]");
  out = out.replace(NUMBER_RE, "[N]");
  return out;
}

/** Normalise a whole log, returning one normalised line per input line. */
export function normalizeLog(text: string): string[] {
  return text.split(/\r?\n/).map(normalizeLine);
}