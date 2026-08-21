import type { ExtractedLogInfo, SourceRef } from "@/types";

/**
 * Extraction of structured fields from raw application log text (section 6 of
 * the requirements). Pure functions, no I/O, unit-testable.
 */

const TIMESTAMP_RE =
  /\b(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:[.,]\d{1,6})?(Z|[+-]\d{2}:?\d{2})?\b/g;

const LEVEL_RE =
  /\b(TRACE|DEBUG|INFO|NOTICE|WARNING|WARN|ERROR|SEVERE|FATAL|CRITICAL)\b/g;

const IDENTIFIER_RE =
  /\b(transactionId|transaction_id|requestId|request_id|traceId|trace_id|correlationId|correlation_id|sessionId|session_id|userId|user_id)\s*[=:]\s*"?"?([A-Za-z0-9_\-./:=]+)/gi;

/** Exception class names such as java.lang.NullPointerException or SQLException. */
const EXCEPTION_RE =
  /\b((?:[A-Za-z_][\w$]*\.)+[A-Za-z_][\w$]*(?:Exception|Error)|[A-Z][\w$]*(?:Exception|Error))\b/g;

/** Stack frame: `at com.example.PaymentService.process(PaymentService.java:125)` */
const SOURCE_FRAME_RE =
  /\bat\s+([A-Za-z_][\w$.<>]*)?\s*\(([A-Za-z_][\w$.]*\.(?:java|kt|scala|groovy|ts|js|jsx|tsx|py|c|cpp|cs|php))(?::(\d+))?\)/g;

/** Frame without a method: `at PaymentService.java:125` */
const SOURCE_BARE_RE =
  /\bat\s+([A-Za-z_][\w$.]*\.(?:java|kt|scala|groovy|ts|js|jsx|tsx|py|c|cpp|cs|php))(?::(\d+))?/g;

/** Bare reference: `PaymentService.java:125` */
const SOURCE_INLINE_RE =
  /\b([A-Za-z_][\w$]*\.(?:java|kt|scala|groovy|ts|js|jsx|tsx|py|c|cpp|cs|php))(?::(\d+))\b/g;

/** Explicit HTTP references: `HTTP 500`, `status=500`, `statusCode: 503`, `HTTP/1.1 500 ...` */
const HTTP_EXPLICIT_RE =
  /\b(?:HTTP[/\s]*|HTTP\/[0-9.]+[\s:]+|status\s*[=:]\s*|statusCode\s*[=:]\s*|status_code\s*[=:]\s*|http_status\s*[=:]\s*|httpStatus\s*[=:]\s*)([1-5]\d\d)\b/gi;

/** Standalone 4xx/5xx codes appearing on error-like lines. */
const HTTP_STANDALONE_RE = /\b([4-5]\d\d)\b/g;
const ERROR_LIKE_LINE_RE =
  /(?:http|status|statuscode|status_code|error|fail|exception|response|denied|timeout|reject)/i;

const STACK_TRACE_RE = /\bat\s+[A-Za-z_][\w$.]{1,}/m;
const CAUSED_BY_RE = /\bCaused\s+by:/;

const LEVEL_TOKEN_IGNORE_RE = /^(TRACE|DEBUG|INFO|NOTICE|WARNING|WARN|ERROR|SEVERE|FATAL|CRITICAL)$/i;
const COMPONENT_TOKEN_RE = /^[A-Za-z][A-Za-z0-9_.\-]*$/;

/** Common non-component tokens that follow a level (e.g. "INFO started ..."). */
const COMPONENT_STOPWORDS = new Set([
  "started", "finished", "completed", "processing", "received", "sending",
  "connected", "disconnected", "initializing", "initialised", "initialized",
  "loading", "found", "closing", "opening", "request", "response", "failed",
  "success", "successful", "begin", "end", "done", "running", "stopped",
  "entering", "leaving", "invoking", "calling", "returned", "thrown",
  "encountered", "detected", "shutting", "shutdown", "starting", "ready",
  "using", "with", "from", "to", "the", "a", "an", "on", "for", "at",
]);

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function firstMatchValue(text: string, regex: RegExp): string | null {
  const m = text.match(regex);
  return m ? m[1] : null;
}

function extractTimestamps(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TIMESTAMP_RE)) {
    // Keep the exact written form (space or T separator, fraction, zone).
    out.push(m[0]);
  }
  return unique(out);
}

function extractLevels(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(LEVEL_RE)) out.push(m[1]);
  return unique(out);
}

function extractIdentifiers(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(IDENTIFIER_RE)) {
    // Keep the key exactly as written (transactionId, transaction_id, ...).
    if (!(m[1] in out)) out[m[1]] = m[2];
  }
  return out;
}

function extractExceptions(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(EXCEPTION_RE)) {
    const full = m[1];
    const short = full.split(".").pop() ?? full;
    out.push(short);
  }
  return unique(out);
}

function extractSources(text: string): SourceRef[] {
  const out: SourceRef[] = [];
  const pushIfNew = (ref: SourceRef) => {
    const already = out.some(
      (r) => r.file === ref.file && r.line === ref.line && r.symbol === ref.symbol,
    );
    if (!already) out.push(ref);
  };

  for (const m of text.matchAll(SOURCE_FRAME_RE)) {
    pushIfNew({ file: m[2], line: m[3] ? Number(m[3]) : null, symbol: m[1] ?? null });
  }
  for (const m of text.matchAll(SOURCE_BARE_RE)) {
    pushIfNew({ file: m[1], line: m[2] ? Number(m[2]) : null, symbol: null });
  }
  for (const m of text.matchAll(SOURCE_INLINE_RE)) {
    pushIfNew({ file: m[1], line: Number(m[2]), symbol: null });
  }
  return out.slice(0, 12);
}

/** Component = identifier right after a level token, e.g. ERROR PaymentBatch. */
function extractComponents(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(LEVEL_RE)) {
    const tail = text.slice(m.index + m[0].length);
    const tokens = (tail.match(/\b([A-Za-z][A-Za-z0-9_.\-]*)\b/g) ?? []).slice(0, 3);
    const picked = tokens.find((token) => {
      if (LEVEL_TOKEN_IGNORE_RE.test(token)) return false;
      if (COMPONENT_STOPWORDS.has(token.toLowerCase())) return false;
      if (!COMPONENT_TOKEN_RE.test(token)) return false;
      if (/^[a-z0-9]{1,2}$/i.test(token)) return false;
      return true;
    });
    if (picked) out.push(picked);
  }
  return unique(out);
}

function extractHttpStatuses(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(HTTP_EXPLICIT_RE)) {
    const code = Number(m[1]);
    if (code >= 100 && code <= 599) out.add(code);
  }
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!ERROR_LIKE_LINE_RE.test(line)) continue;
    for (const m of line.matchAll(HTTP_STANDALONE_RE)) {
      const code = Number(m[1]);
      if (code >= 400 && code <= 599) out.add(code);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Extract structured information from raw log text. Returns an empty-ish info
 * object for empty input (never throws).
 */
export function extractLogInfo(text: string): ExtractedLogInfo {
  const levels = extractLevels(text);
  const sources = extractSources(text);
  return {
    timestamps: extractTimestamps(text),
    levels,
    components: extractComponents(text),
    identifiers: extractIdentifiers(text),
    exceptions: extractExceptions(text),
    sources,
    httpStatuses: extractHttpStatuses(text),
    stackTrace: STACK_TRACE_RE.test(text) || CAUSED_BY_RE.test(text),
  };
}

/** Convenience: first timestamp if any, used by the UI's related fields. */
export function firstTimestamp(info: ExtractedLogInfo): string | null {
  return info.timestamps[0] ?? null;
}

/** Convenience: first exception if any. */
export function firstException(info: ExtractedLogInfo): string | null {
  return info.exceptions[0] ?? null;
}

/**
 * First source symbol, e.g. com.example.PaymentService.process, used to build
 * contextual root-cause suggestions.
 */
export function firstSourceSymbol(info: ExtractedLogInfo): string | null {
  return info.sources[0]?.symbol ?? null;
}

/** Extract a first-level component used for tuning suggestions. */
export function firstComponent(info: ExtractedLogInfo): string | null {
  return info.components[0] ?? null;
}

export function isLogEmpty(text: string): boolean {
  return text.trim().length === 0;
}

/** Used by tests to sanity-check timestamp capture edge cases. */
export const _internals = { firstMatchValue };
