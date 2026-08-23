/**
 * Minimal latency / success / failure metric hooks (Engineering Review §9).
 *
 * Emits one structured `metric` log line per measurement (see logger.ts).
 * There is no external sink today — the JSON lines are the contract, so a
 * future collector (or `npm run` log scraping) can consume them unchanged.
 *
 * Usage (sync):
 *   const { durationMs, result } = timedMetric("export", () => exportAllData());
 * Usage (async):
 *   const outcome = await timedMetricAsync("ai_fallback", () => runFallback(...));
 */

import { logStructured } from "./logger";

export type MetricEvent =
  | "analysis"
  | "export"
  | "import"
  | "backup"
  | "ai_fallback"
  | "rules_import";

export interface MetricFields {
  ok: boolean;
  durationMs: number;
  [key: string]: unknown;
}

export function emitMetric(event: MetricEvent, fields: MetricFields): void {
  logStructured({
    level: "info",
    event: "metric",
    metric: event,
    ...fields,
  });
}

export function timedMetric<T>(event: MetricEvent, fn: () => T): { result: T; durationMs: number } {
  const start = Date.now();
  try {
    const result = fn();
    emitMetric(event, { ok: true, durationMs: Date.now() - start });
    return { result, durationMs: Date.now() - start };
  } catch (error) {
    emitMetric(event, {
      ok: false,
      durationMs: Date.now() - start,
      errorClass: error instanceof Error ? error.name : typeof error,
    });
    throw error;
  }
}

export async function timedMetricAsync<T>(
  event: MetricEvent,
  fn: () => Promise<T>,
): Promise<{ result: T; durationMs: number }> {
  const start = Date.now();
  try {
    const result = await fn();
    emitMetric(event, { ok: true, durationMs: Date.now() - start });
    return { result, durationMs: Date.now() - start };
  } catch (error) {
    emitMetric(event, {
      ok: false,
      durationMs: Date.now() - start,
      errorClass: error instanceof Error ? error.name : typeof error,
    });
    throw error;
  }
}