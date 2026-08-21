import { describe, expect, it } from "vitest";
import { analyzeLogText } from "./engine";

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
  });

  it("includes generic investigation steps", () => {
    const result = analyzeLogText("ERROR something broke");
    for (const step of [
      "Check input data.",
      "Check recent deployment.",
      "Check related logs.",
    ]) {
      expect(result.immediateInvestigation).toContain(step);
    }
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

  it("is deterministic across calls", () => {
    const log = "ERROR timeout waiting for reply";
    expect(analyzeLogText(log)).toEqual(analyzeLogText(log));
  });
});