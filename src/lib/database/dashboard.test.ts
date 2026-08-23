import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, initDb } from "./db";
import { createHistoryEntry, validateHistoryInput } from "./history";
import { createIncident, validateIncidentInput } from "./incidents";
import { buildDashboardSummary, buildDayTrend, localDay } from "./dashboard";

let tempDir: string;
let seq = 0;

beforeEach(() => {
  seq += 1;
  initDb(path.join(tempDir, `dashboard-${seq}.db`));
});

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pst-dashboard-"));
});

afterAll(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function save(
  tool: string,
  summary: string,
  severity: "Critical" | "High" | "Medium" | "Low" | "Informational" | null,
  system: string,
  payload: Record<string, unknown>,
  createdAt?: string,
) {
  return createHistoryEntry(
    validateHistoryInput({ tool, summary, severity, system, payload: JSON.stringify(payload) }),
    { createdAt },
  );
}

function analysisPayload(severity: string, errorTypes: string[], source: "rules" | "ai-fallback") {
  const base = {
    analysis: {
      severity,
      errorTypes,
      affectedComponents: [],
      rootCauses: [],
      immediateInvestigation: [],
      suggestedFixes: [],
      longTermImprovements: [],
      matchedRuleIds: source === "rules" ? ["builtin:1"] : [],
      unknownTriage: null,
      matchedEvidence: [],
    },
    analysisSource: source,
  };
  if (source === "ai-fallback") {
    return {
      ...base,
      aiFallback: {
        severity,
        errorTypes,
        model: "test-model",
        confidence: 0.9,
        cached: false,
      },
    };
  }
  return base;
}

describe("localDay / buildDayTrend", () => {
  it("formats an ISO timestamp into a local calendar date", () => {
    const iso = new Date(2026, 7, 21, 12, 0, 0).toISOString(); // 2026-08-21 local
    expect(localDay(iso)).toBe("2026-08-21");
  });

  it("builds exactly `days` buckets with correct totals and highPlus", () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const trend = buildDayTrend(
      [
        { createdAt: today.toISOString(), severity: "High" },
        { createdAt: today.toISOString(), severity: "Informational" },
        { createdAt: yesterday.toISOString(), severity: "Critical" },
      ],
      7,
    );
    expect(trend).toHaveLength(7);
    const last = trend[trend.length - 1];
    expect(last.day).toBe(localDay(today.toISOString()));
    expect(last.total).toBe(2);
    expect(last.highPlus).toBe(1);
    const prev = trend[trend.length - 2];
    expect(prev.day).toBe(localDay(yesterday.toISOString()));
    expect(prev.total).toBe(1);
    expect(prev.highPlus).toBe(1);
    expect(trend[0].total).toBe(0);
  });
});

describe("buildDashboardSummary", () => {
  it("returns an all-zero summary on an empty database", () => {
    const summary = buildDashboardSummary();
    expect(summary.history.total).toBe(0);
    expect(summary.history.bySeverity).toEqual([]);
    expect(summary.history.errorTypes).toEqual([]);
    expect(summary.history.trend.length).toBe(14);
    expect(summary.incidents.total).toBe(0);
    expect(summary.incidents.open).toBe(0);
  });

  it("aggregates severity / tool / system distribution from history rows", () => {
    save(
      "log-analyzer",
      "Ledger batch failed",
      "High",
      "ledger",
      analysisPayload("High", ["SQL Exception"], "rules"),
    );
    save(
      "log-analyzer",
      "Payment NPE",
      "Critical",
      "payment",
      analysisPayload("Critical", ["NullPointerException"], "rules"),
    );
    save("json", "a formatted doc", null, "", {});

    const summary = buildDashboardSummary();
    expect(summary.history.total).toBe(3);

    const severities = Object.fromEntries(
      summary.history.bySeverity.map((s) => [s.severity, s.count]),
    );
    expect(severities.High).toBe(1);
    expect(severities.Critical).toBe(1);

    const tools = Object.fromEntries(summary.history.byTool.map((t) => [t.name, t.count]));
    expect(tools["log-analyzer"]).toBe(2);
    expect(tools.json).toBe(1);

    const systems = Object.fromEntries(summary.history.bySystem.map((s) => [s.name, s.count]));
    expect(systems.ledger).toBe(1);
    expect(systems.payment).toBe(1);
    expect(systems["(none)"]).toBe(1);
  });

  it("counts error types across stored analysis snapshots (rules + ai-fallback)", () => {
    save(
      "log-analyzer",
      "DB timeout",
      "High",
      "ledger",
      analysisPayload("High", ["Timeout", "SQL Exception"], "rules"),
    );
    save(
      "log-analyzer",
      "AI-filled analysis",
      "Medium",
      "ledger",
      analysisPayload("Medium", ["Timeout", "Custom Error"], "ai-fallback"),
    );
    // Non-log tools and legacy rows (no analysis) must not contribute.
    save("cron", "schedule", "Low", "", {});

    const summary = buildDashboardSummary();
    const counts = Object.fromEntries(summary.history.errorTypes.map((e) => [e.name, e.count]));
    expect(counts.Timeout).toBe(2);
    expect(counts["SQL Exception"]).toBe(1);
    expect(counts["Custom Error"]).toBe(1);
    expect(summary.history.aiFallbackCount).toBe(1);
  });

  it("counts highPlus by severity rank and open incidents", () => {
    save(
      "log-analyzer",
      "disk full",
      "Critical",
      "fs",
      analysisPayload("Critical", ["Disk Full"], "rules"),
    );
    save(
      "log-analyzer",
      "minor",
      "Low",
      "fs",
      analysisPayload("Low", ["Permission Error"], "rules"),
    );
    createIncident(
      validateIncidentInput({
        title: "Batch failed",
        system: "ledger",
        severity: "High",
        status: "Investigating",
      }),
    );
    createIncident(
      validateIncidentInput({
        title: "Old issue",
        system: "ledger",
        severity: "Medium",
        status: "Closed",
      }),
    );

    const summary = buildDashboardSummary();
    const highPlus = summary.history.bySeverity
      .filter((s) => s.severity === "High" || s.severity === "Critical")
      .reduce((sum, s) => sum + s.count, 0);
    expect(highPlus).toBe(1);
    expect(summary.incidents.total).toBe(2);
    expect(summary.incidents.open).toBe(1);
    const statuses = Object.fromEntries(summary.incidents.byStatus.map((s) => [s.name, s.count]));
    expect(statuses.Investigating).toBe(1);
    expect(statuses.Closed).toBe(1);
  });
});