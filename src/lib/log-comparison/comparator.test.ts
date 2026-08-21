import { describe, expect, it } from "vitest";
import { compareLogs } from "./comparator";

describe("log comparison (section 7)", () => {
  it("detects regression: HTTP 200 -> 500 with new NullPointerException", () => {
    const result = compareLogs(
      "2026-08-21 10:00:00 INFO PaymentBatch completed HTTP 200",
      `2026-08-21 10:15:22 ERROR PaymentBatch HTTP 500
java.lang.NullPointerException
at com.example.PaymentService.process(PaymentService.java:125)`,
    );
    expect(result.regression).toBe(true);
    expect(result.summary).toBe("Regression detected.");
    expect(result.newErrors).toContain("NullPointerException");
    expect(result.changedHttpStatuses).toContainEqual({ before: 200, after: 500 });
  });

  it("reports clean comparison as no regression", () => {
    const result = compareLogs(
      "2026-08-21 10:00:00 INFO BatchJob started",
      "2026-08-21 10:05:00 INFO BatchJob finished",
    );
    expect(result.regression).toBe(false);
    expect(result.summary).toBe("No regression detected.");
    expect(result.newErrors).toEqual([]);
  });

  it("flags missing errors when they disappear", () => {
    const result = compareLogs(
      "ERROR NullPointerException\nat Foo.java:1",
      "INFO all good",
    );
    expect(result.missingErrors).toContain("NullPointerException");
  });

  it("diffs changed components", () => {
    const result = compareLogs(
      "ERROR PaymentBatch failed",
      "ERROR SettlementBatch failed",
    );
    expect(result.changedComponents).toContain("SettlementBatch");
  });

  it("requires both sides to be non-empty", () => {
    expect(() => compareLogs("", "x")).toThrowError(/before/);
    expect(() => compareLogs("x", "  ")).toThrowError(/after/);
  });
});