import type {
  DashboardSummary,
  DayBucket,
  NameCount,
  Severity,
  SeverityCount,
} from "@/types";
import { SEVERITY_ORDER } from "@/types";
import { getDb } from "./db";

/**
 * Dashboard aggregation (reporting layer beyond CSV exports).
 *
 * Questions the dashboard answers WITHOUT opening a single CSV:
 *   - how many analyses were saved, and of which severity?
 *   - which error types dominate (parsed from the stored analysis snapshots)?
 *   - which tools / systems are used most?
 *   - is the last N-day trend improving (High+ counts)?
 *   - incidents: totals, open, by status?
 *
 * Aggregation runs straight over the SQLite tables with JSON1 (bundled with
 * SQLite), so even a large history stays fast — error-type parsing never
 * loads whole payloads into JS.
 */

const SEVERITIES: Severity[] = ["Critical", "High", "Medium", "Low", "Informational"];

/** Local calendar date (YYYY-MM-DD) of an ISO timestamp, in server's zone. */
export function localDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function buildDayTrend(
  rows: Array<{ createdAt: string; severity: Severity | null }>,
  days: number,
): DayBucket[] {
  const buckets: DayBucket[] = [];
  const index = new Map<string, DayBucket>();
  const today = new Date();
  for (let offset = days - 1; offset >= 0; offset--) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(
      day.getDate(),
    ).padStart(2, "0")}`;
    const bucket: DayBucket = { day: key, total: 0, highPlus: 0 };
    buckets.push(bucket);
    index.set(key, bucket);
  }
  for (const row of rows) {
    const bucket = index.get(localDay(row.createdAt));
    if (!bucket) continue;
    bucket.total += 1;
    if (row.severity && (row.severity === "High" || row.severity === "Critical")) {
      bucket.highPlus += 1;
    }
  }
  return buckets;
}

export interface DashboardOptions {
  /** Trend horizon in days (default 14). */
  days?: number;
}

/**
 * Build the dashboard summary from the current database contents. Pure read —
 * never writes, never throws for empty data (all-zero summary instead).
 */
export function buildDashboardSummary(opts: DashboardOptions = {}): DashboardSummary {
  const db = getDb();
  const days = Number.isInteger(opts.days) && (opts.days ?? 0) > 0 ? (opts.days as number) : 14;

  // Lightweight pass over every history row: no payloads, just the columns
  // needed for totals, severity/tool/system distribution and the trend.
  const historyRows = db
    .prepare("SELECT tool, system, severity, created_at FROM history")
    .all() as Array<{ tool: string; system: string; severity: string | null; created_at: string }>;

  const bySeverity: SeverityCount[] = [];
  const byTool: NameCount[] = [];
  const bySystem: NameCount[] = [];
  const severityMap = new Map<string, number>();
  const toolMap = new Map<string, number>();
  const systemMap = new Map<string, number>();

  const trendSeed: Array<{ createdAt: string; severity: Severity | null }> = [];
  for (const row of historyRows) {
    trendSeed.push({
      createdAt: row.created_at,
      severity: row.severity as Severity | null,
    });
    if (row.severity) {
      severityMap.set(row.severity, (severityMap.get(row.severity) ?? 0) + 1);
    }
    toolMap.set(row.tool, (toolMap.get(row.tool) ?? 0) + 1);
    const system = row.system.trim();
    systemMap.set(system || "(none)", (systemMap.get(system || "(none)") ?? 0) + 1);
  }
  for (const severity of SEVERITIES) {
    const count = severityMap.get(severity) ?? 0;
    if (count > 0) bySeverity.push({ severity, count });
  }
  bySeverity.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);
  for (const [name, count] of [...toolMap.entries()].sort((a, b) => b[1] - a[1])) {
    byTool.push({ name, count });
  }
  for (const [name, count] of [...systemMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    bySystem.push({ name, count });
  }

  // Error-type frequency + AI-fallback count, parsed with JSON1 straight in
  // SQLite (json_extract on non-JSON payloads safely yields NULL / '[]').
  const logRows = db
    .prepare(
      `SELECT
         json_extract(payload, '$.analysisSource') AS source,
         json_extract(payload, '$.aiFallback.errorTypes') AS ai_types,
         json_extract(payload, '$.analysis.errorTypes') AS rule_types
       FROM history WHERE tool = 'log-analyzer'`,
    )
    .all() as Array<{ source: string | null; ai_types: unknown; rule_types: unknown }>;

  const errorTypeCounts = new Map<string, number>();
  let aiFallbackCount = 0;
  for (const row of logRows) {
    if (row.source === "ai-fallback") aiFallbackCount += 1;
    const types = row.source === "ai-fallback" ? row.ai_types : row.rule_types;
    // json_extract returns JSON arrays as TEXT (better-sqlite3 does not
    // auto-parse) — normalise so both raw arrays and strings are handled.
    let parsed: unknown = types;
    if (typeof types === "string") {
      try {
        parsed = JSON.parse(types);
      } catch {
        parsed = null;
      }
    }
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (typeof entry !== "string" || !entry.trim()) continue;
        const key = entry.trim();
        errorTypeCounts.set(key, (errorTypeCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const errorTypes: NameCount[] = [...errorTypeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, count]) => ({ name, count }));

  // Incidents.
  const incidentTotal = db.prepare("SELECT COUNT(*) AS n FROM incidents").get() as { n: number };
  const incidentOpen = db
    .prepare("SELECT COUNT(*) AS n FROM incidents WHERE status != 'Closed'")
    .get() as { n: number };
  const statusRows = db
    .prepare("SELECT status, COUNT(*) AS n FROM incidents GROUP BY status ORDER BY n DESC")
    .all() as Array<{ status: string; n: number }>;

  return {
    generatedAt: new Date().toISOString(),
    history: {
      total: historyRows.length,
      aiFallbackCount,
      bySeverity,
      byTool,
      bySystem,
      errorTypes,
      trend: buildDayTrend(trendSeed, days),
    },
    incidents: {
      total: incidentTotal.n,
      open: incidentOpen.n,
      byStatus: statusRows.map((row) => ({ name: row.status, count: row.n })),
    },
  };
}