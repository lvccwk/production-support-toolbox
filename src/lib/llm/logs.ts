import { ToolError } from "@/lib/errors";

/**
 * Shared input validation for AI routes: accept a single `log` string or a
 * `logs` array (feature A: multi-log analysis), with per-log and total caps.
 */

export const MAX_LOG_CHARS = 200_000;
export const MAX_LOGS = 5;
export const MAX_TOTAL_CHARS = 600_000;

export function parseLogsInput(raw: { log?: unknown; logs?: unknown }): string[] {
  const source = Array.isArray(raw.logs) ? raw.logs : raw.log !== undefined ? [raw.log] : [];
  if (source.length === 0) {
    throw new ToolError("Please provide a log to analyse.");
  }
  if (source.length > MAX_LOGS) {
    throw new ToolError(`Too many logs (max ${MAX_LOGS}).`);
  }
  const logs = source.map((entry) => {
    if (typeof entry !== "string") throw new ToolError("Each log must be text.");
    return entry;
  });
  if (logs.some((l) => !l.trim())) {
    throw new ToolError("Please provide a log to analyse.");
  }
  const total = logs.reduce((n, l) => n + l.length, 0);
  if (total > MAX_TOTAL_CHARS) {
    throw new ToolError(`Logs too large (max ${MAX_TOTAL_CHARS} chars total).`);
  }
  if (logs.some((l) => l.length > MAX_LOG_CHARS)) {
    throw new ToolError(`A single log can be at most ${MAX_LOG_CHARS} chars.`);
  }
  return logs;
}