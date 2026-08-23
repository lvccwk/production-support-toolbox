/**
 * Structured server-side logging (Engineering Review §9).
 *
 * One JSON line per event to stdout, tagged `pst: true` so other tooling can
 * filter for it. NEVER log: full request payloads, log text, PII, credentials,
 * Authorization headers or API keys — only metadata that helps correlate a
 * request (requestId, route, duration, status, error class).
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  event: string;
  requestId?: string;
  route?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  errorClass?: string;
  [key: string]: unknown;
}

export function logStructured(entry: LogEntry): void {
  const line = JSON.stringify({ pst: true, ts: new Date().toISOString(), ...entry });
  if (entry.level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

/** One-line record of a completed API request. */
export function logApiEvent(entry: LogEntry & { event?: string }): void {
  const level: LogLevel =
    entry.level ?? (entry.status !== undefined && entry.status >= 500 ? "error" : "info");
  const event = entry.event ?? "api";
  logStructured({ ...entry, level, event });
}