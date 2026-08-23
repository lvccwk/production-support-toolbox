import { describe, expect, it } from "vitest";
import { buildDashboardReportCsv } from "./reportCsv";
import type { DashboardSummary } from "@/types";

const summary: DashboardSummary = {
  generatedAt: "2026-08-23T10:00:00.000Z",
  history: {
    total: 7,
    aiFallbackCount: 4,
    bySeverity: [
      { severity: "Critical", count: 1 },
      { severity: "High", count: 3 },
      { severity: "Medium", count: 1 },
      { severity: "Low", count: 1 },
      { severity: "Informational", count: 1 },
    ],
    byTool: [{ name: "log-analyzer", count: 7 }],
    bySystem: [
      { name: "ledger", count: 4 },
      { name: "(none)", count: 3 },
    ],
    errorTypes: [
      { name: "Timeout", count: 3 },
      { name: "=SUM(A1)", count: 4 },
    ],
    trend: [
      { day: "2026-08-22", total: 0, highPlus: 0 },
      { day: "2026-08-23", total: 7, highPlus: 4 },
    ],
  },
  incidents: {
    total: 2,
    open: 1,
    byStatus: [
      { name: "Investigating", count: 1 },
      { name: "Closed", count: 1 },
    ],
  },
};

describe("buildDashboardReportCsv", () => {
  it("emits a BOM-prefixed, CRLF, sectioned CSV", () => {
    const csv = buildDashboardReportCsv(summary);
    expect(csv.startsWith("\uFEFF\"## Summary\"")).toBe(true);
    expect(csv).toContain('"## Severity"');
    expect(csv).toContain('"## Error types"');
    expect(csv).toContain('"## Trend"');
    expect(csv.split("\r\n").length).toBeGreaterThan(10);
  });

  it("protects spreadsheet formulas from injection", () => {
    const csv = buildDashboardReportCsv(summary);
    // "=SUM(A1)" must be neutralised with a leading apostrophe.
    expect(csv).toContain("\"'=SUM(A1)\"");
    expect(csv).not.toContain('"=SUM(A1)"');
  });

  it("keeps trend, summary and severity rows complete", () => {
    const csv = buildDashboardReportCsv(summary);
    expect(csv).toContain('"2026-08-23","7","4"');
    expect(csv).toContain('"High","3","42.9"'); // 3/7 = 42.9% (one decimal)
    expect(csv).toContain('"highPlusCount","4"');
    expect(csv).toContain('"highPlusPct","57.1"');
  });
});