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
    expect(result.errorClusters.added.some((c) => c.key.startsWith("NullPointerException@"))).toBe(true);
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
    expect(result.errorClusters.removed.some((c) => c.key.startsWith("NullPointerException@"))).toBe(true);
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

describe("log comparison — Phase 1 de-noising", () => {
  it("treats logs differing only in timestamps and ids as identical", () => {
    const before = `2026-08-21 10:00:00 ERROR PaymentBatch transactionId=A1
java.lang.NullPointerException
at PaymentService.java:125`;
    const after = `2026-08-21 10:01:00 ERROR PaymentBatch transactionId=B2
java.lang.NullPointerException
at PaymentService.java:125`;
    const result = compareLogs(before, after);
    expect(result.regression).toBe(false);
    expect(result.addedLines).toEqual([]);
    expect(result.removedLines).toEqual([]);
    expect(result.errorClusters.added).toEqual([]);
    expect(result.errorClusters.removed).toEqual([]);
    expect(result.newErrors).toEqual([]);
  });

  it("ignores count-only changes when they are not error-like", () => {
    const result = compareLogs(
      "INFO processed 5 orders",
      "INFO processed 6 orders",
    );
    expect(result.regression).toBe(false);
    expect(result.addedLines).toEqual([]);
  });

  it("clusters repeated new errors into one kind with a count", () => {
    const before = "2026-08-21 10:00:00 INFO PaymentBatch completed";
    const after = `2026-08-21 10:15:00 ERROR PaymentBatch
java.lang.NullPointerException
at PaymentService.java:125
java.lang.NullPointerException
at PaymentService.java:126
ERROR ValueError: nope
at parse.py:10`;
    const result = compareLogs(before, after);
    const npe = result.errorClusters.added.find((c) =>
      c.key.startsWith("NullPointerException@PaymentService.java"),
    );
    expect(npe?.count).toBe(2);
    const valueError = result.errorClusters.added.find((c) =>
      c.key.startsWith("ValueError@parse.py"),
    );
    expect(valueError?.count).toBe(1);
    expect(result.regression).toBe(true);
  });

  it("does not treat a repeat of an existing error kind as regression", () => {
    const before = `2026-08-21 10:00:00 ERROR PaymentBatch
java.lang.NullPointerException
at PaymentService.java:125`;
    const after = `2026-08-21 10:15:00 ERROR PaymentBatch
java.lang.NullPointerException
at PaymentService.java:125
java.lang.NullPointerException
at PaymentService.java:126`;
    const result = compareLogs(before, after);
    expect(result.errorClusters.added).toEqual([]);
    expect(result.regression).toBe(false);
  });
});