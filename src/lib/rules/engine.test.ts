import { describe, expect, it } from "vitest";
import { analyzeLog, analyzeLogText } from "./engine";
import { extractLogInfo } from "@/lib/log-parser/parser";
import type { LogRule } from "@/types";

describe("rule engine — requirement section 21 log parsing cases", () => {
  it("detects NullPointerException with guidance", () => {
    const result = analyzeLogText(`2026-08-21 10:15:22 ERROR PaymentBatch
java.lang.NullPointerException
at com.example.PaymentService.process(PaymentService.java:125)`);
    expect(result.errorTypes).toContain("NullPointerException");
    expect(result.matchedRuleIds).toContain("null-pointer");
    expect(result.severity).toBe("High");
    expect(result.suggestedFixes.length).toBeGreaterThan(0);
    expect(
      result.suggestedFixes.some((f) => /null validation/i.test(f)),
    ).toBe(true);
  });

  it("detects HTTP 500 and escalates severity", () => {
    const result = analyzeLogText("ERROR Request failed: HTTP 500");
    expect(result.errorTypes).toContain("HTTP Error");
    expect(result.severity).toBe("High");
  });

  it("detects timeout keywords", () => {
    const result = analyzeLogText("ERROR read timeout after 30s calling ExternalAPI");
    expect(result.errorTypes).toContain("Timeout");
    expect(result.immediateInvestigation.some((s) => /downstream/i.test(s))).toBe(true);
  });

  it("detects SQL errors (SQLException, deadlock, db2)", () => {
    for (const snippet of ["SQLException: table missing", "deadlock detected", "DB2 error -911"]) {
      const result = analyzeLogText(`ERROR ${snippet}`);
      expect(result.errorTypes).toContain("SQL Exception");
      expect(result.affectedComponents).toContain("Database");
    }
  });

  it("detects connection refused", () => {
    const result = analyzeLogText("ERROR Connection refused: connect 10.0.0.5:5432");
    expect(result.errorTypes).toContain("Connection Failure");
  });

  it("detects authentication issues", () => {
    const result = analyzeLogText("ERROR authentication failed: invalid token");
    expect(result.errorTypes).toContain("Authentication Error");
  });

  it("escalates to Critical on FATAL level", () => {
    const result = analyzeLogText("2026-08-21 10:00:00 FATAL BatchJob crashed");
    expect(result.severity).toBe("Critical");
    expect(result.errorTypes).toContain("Unknown Error");
  });

  it("keeps informational severity for a clean log", () => {
    const result = analyzeLogText("2026-08-21 10:00:00 INFO BatchJob started");
    expect(result.severity).toBe("Informational");
    expect(result.errorTypes).toEqual([]);
    expect(result.matchedEvidence).toEqual([]);
    expect(result.unknownTriage).toBeNull();
  });

  it("never emits generic template steps when nothing matched", () => {
    const result = analyzeLogText("ERROR something broke");
    expect(result.errorTypes).toContain("Unknown Error");
    expect(result.unknownTriage).not.toBeNull();
    for (const step of [
      "Check input data.",
      "Check recent deployment.",
      "Check upstream application.",
      "Review database result.",
      "Check related logs.",
    ]) {
      expect(result.immediateInvestigation).not.toContain(step);
      expect(result.immediateInvestigation.some((s) => s.includes(step))).toBe(false);
    }
    expect(
      result.immediateInvestigation.some((s) => s.startsWith("[generic]")),
    ).toBe(false);
  });

  it("appends at most 2 marked generic steps after matched rules", () => {
    const result = analyzeLogText(`2026-08-21 10:15:22 ERROR PaymentBatch
java.lang.NullPointerException
at com.example.PaymentService.process(PaymentService.java:125)`);
    const generics = result.immediateInvestigation.filter((s) =>
      s.startsWith("[generic]"),
    );
    expect(generics.length).toBeLessThanOrEqual(2);
    expect(result.immediateInvestigation[0]).not.toMatch(/^\[generic\]/);
    expect(generics.length).toBeGreaterThan(0);
  });

  it("reports per-rule evidence lines", () => {
    const result = analyzeLogText(`2026-08-21 10:15:22 ERROR PaymentBatch
java.lang.NullPointerException
at com.example.PaymentService.process(PaymentService.java:125)`);
    const npe = result.matchedEvidence.find((m) => m.ruleId === "null-pointer");
    expect(npe?.evidence.map((e) => e.line)).toEqual([2]);
  });

  it("adds contextual root cause with source symbol for NPE", () => {
    const result = analyzeLogText(
      `ERROR PaymentBatch
java.lang.NullPointerException
at com.example.PaymentService.process(PaymentService.java:125)`,
    );
    expect(
      result.rootCauses.some((cause) => /PaymentService/.test(cause)),
    ).toBe(true);
  });

  it("escalates severity with many error-level lines", () => {
    const log = Array.from(
      { length: 5 },
      (_, i) => `2026-08-21 10:0${i}:00 ERROR batch item ${i} failed`,
    ).join("\n");
    const result = analyzeLogText(log);
    expect(result.errorTypes).toContain("Unknown Error");
    expect(result.severity).toBe("High"); // Medium + density escalation
  });

  it("escalates severity when many rules match at once", () => {
    const log = [
      "ERROR worker timed out waiting for reply",
      "ERROR deadlock detected in ledger table",
      "ERROR connection refused to 10.0.0.5:5432",
      "ERROR request finished with HTTP 500",
    ].join("\n");
    const result = analyzeLogText(log);
    expect(result.matchedRuleIds).toHaveLength(4);
    expect(result.severity).toBe("Critical"); // High base + multi-rule escalation
  });

  it("triages unknown errors with exception and language hints", () => {
    const result = analyzeLogText(`2026-08-21 10:00:00 ERROR IngestionJob
ValueError: invalid literal for int(): 'abc'
  File "/opt/app/ingest.py", line 42, in parse_row`);
    expect(result.unknownTriage).not.toBeNull();
    expect(result.unknownTriage?.languageHint).toBe("Python");
    expect(
      result.rootCauses.some((cause) => /wrong type or format/i.test(cause)),
    ).toBe(true);
  });

  it("triages direction from a standalone 5xx code", () => {
    const result = analyzeLogText("2026-08-21 10:00:00 ERROR upstream returned 599");
    expect(result.unknownTriage?.httpDirection).toBe("server");
    expect(
      result.suggestedFixes.some((f) => /receiving service/i.test(f)),
    ).toBe(true);
  });

  it("triages a standalone 4xx code as client-side", () => {
    const result = analyzeLogText("2026-08-21 10:00:00 ERROR upstream responded 403");
    expect(result.unknownTriage?.httpDirection).toBe("client");
  });

  it("is deterministic across calls", () => {
    const log = "ERROR timeout waiting for reply";
    expect(analyzeLogText(log)).toEqual(analyzeLogText(log));
  });
});

describe("engine with extra (custom) rules", () => {
  const customRule: LogRule = {
    id: "custom:1",
    name: "pay-step44-timeout",
    errorType: "Custom Error",
    baseSeverity: "High",
    patterns: [/PaymentBatch.*STEP44.*timeout/i],
    affectedComponents: [],
    rootCauses: ["PAY gateway timeout at STEP44"],
    investigation: ["Check gateway health"],
    suggestedFixes: ["Retry batch"],
    longTermImprovements: ["Add backup gateway"],
  };

  const LOG = "2026-08-21 10:00:00 ERROR PaymentBatch STEP44 timeout waiting for PAY";

  it("matches a custom rule, adds evidence and suppresses Unknown triage", () => {
    const info = extractLogInfo(LOG);
    const result = analyzeLog(LOG, info, [customRule]);
    expect(result.matchedRuleIds).toContain("custom:1");
    expect(result.errorTypes).toContain("Custom Error");
    expect(result.unknownTriage).toBeNull();
    expect(result.rootCauses).toContain("PAY gateway timeout at STEP44");
    const evidence = result.matchedEvidence.find((m) => m.ruleId === "custom:1");
    expect(evidence?.evidence[0]?.line).toBe(1);
  });

  it("keeps behaviour identical without extra rules", () => {
    const info = extractLogInfo(LOG);
    const plain = analyzeLog(LOG, info);
    expect(plain.matchedRuleIds).not.toContain("custom:1");
  });
});