import type { DashboardSummary } from "@/types";
import { csvEscape } from "@/lib/csv";

/**
 * Sectioned, spreadsheet-safe CSV of the dashboard aggregates. Mirrors the
 * GUI percentages (fmtPct below), BOM + CRLF like the server exports. Pure
 * client-side logic — no server round-trip needed.
 */

/** Integer when it looks exact (43%), one decimal for small shares (8.3%). */
function fmtPct(pct: number): string {
  const rounded = Math.round(pct);
  return Math.abs(pct - rounded) < 0.05 ? String(rounded) : pct.toFixed(1);
}

export function buildDashboardReportCsv(summary: DashboardSummary): string {
  const { history, incidents } = summary;
  const total = history.total;
  const highPlus = history.bySeverity
    .filter((s) => s.severity === "High" || s.severity === "Critical")
    .reduce((sum, s) => sum + s.count, 0);
  const pct = (part: number) => (total > 0 ? fmtPct((part / total) * 100) : "0");

  const rows: string[] = [];
  const push = (cells: unknown[]) => rows.push(cells.map(csvEscape).join(","));

  // --- Summary ------------------------------------------------------------
  push(["## Summary"]);
  push(["metric", "value"]);
  push(["generatedAt", summary.generatedAt]);
  push(["totalAnalyses", total]);
  push(["aiFallbackCount", history.aiFallbackCount]);
  push(["highPlusCount", highPlus]);
  push(["highPlusPct", pct(highPlus)]);
  push(["aiFallbackPct", pct(history.aiFallbackCount)]);
  push(["openIncidents", incidents.open]);
  push(["totalIncidents", incidents.total]);
  rows.push("");

  // --- Generic name/count/pct sections ------------------------------------
  const section = (
    title: string,
    header: string[],
    items: Array<{ name: string; count: number }>,
  ) => {
    const sub = items.reduce((sum, i) => sum + i.count, 0);
    push([`## ${title}`]);
    push(header);
    for (const item of items) {
      push([item.name, item.count, sub > 0 ? fmtPct((item.count / sub) * 100) : "0"]);
    }
    rows.push("");
  };

  section(
    "Severity",
    ["severity", "count", "pct"],
    history.bySeverity.map((s) => ({ name: s.severity, count: s.count })),
  );
  section("Error types", ["errorType", "count", "pct"], history.errorTypes);
  section("Tools", ["tool", "count", "pct"], history.byTool);
  section("Systems", ["system", "count", "pct"], history.bySystem);
  section("Incident status", ["status", "count", "pct"], incidents.byStatus);

  // --- Trend ---------------------------------------------------------------
  push(["## Trend"]);
  push(["day", "total", "highPlus"]);
  for (const bucket of history.trend) {
    push([bucket.day, bucket.total, bucket.highPlus]);
  }
  rows.push("");

  return `\uFEFF${rows.join("\r\n")}`;
}