import { describe, expect, it } from "vitest";
import {
  baselineErrorLevelFlag,
  computeMetrics,
  evaluateLogFile,
} from "./runner";

describe("computeMetrics", () => {
  it("computes precision/recall/F1 on a small labelled set", () => {
    // 5 lines; positives = [1,2]; flagged = [1,3]
    const m = computeMetrics([1, 3], [1, 2], 5);
    expect(m).toEqual({
      tp: 1,
      fp: 1,
      tn: 2,
      fn: 1,
      precision: 0.5,
      recall: 0.5,
      f1: 0.5,
      accuracy: 0.6,
      flaggedCount: 2,
      positiveCount: 2,
    });
  });

  it("returns null precision when nothing was flagged", () => {
    const m = computeMetrics([], [1], 3);
    expect(m.precision).toBeNull();
    expect(m.recall).toBe(0);
    expect(m.f1).toBeNull();
  });

  it("returns null recall when there are no positives", () => {
    const m = computeMetrics([1], [], 3);
    expect(m.precision).toBe(0);
    expect(m.recall).toBeNull();
    expect(m.f1).toBeNull();
  });

  it("handles the empty case", () => {
    const m = computeMetrics([], [], 0);
    expect(m.accuracy).toBe(0);
    expect(m.precision).toBeNull();
    expect(m.recall).toBeNull();
  });
});

describe("baselineErrorLevelFlag", () => {
  it("flags ERROR/FATAL/SEVERE/CRITICAL lines only", () => {
    const lines = [
      "INFO started",
      "ERROR boom",
      "WARN slow",
      "FATAL crash",
      "INFO ok",
    ];
    expect(baselineErrorLevelFlag(lines)).toEqual([2, 4]);
  });
});

describe("evaluateLogFile", () => {
  const LOG = `2026-08-21 10:15:22 INFO PaymentBatch started
2026-08-21 10:15:23 ERROR PaymentBatch java.lang.NullPointerException
at com.example.PaymentService.process(PaymentService.java:125)
2026-08-21 10:15:24 INFO PaymentBatch finished`;

  it("flags lines matched by rules and collects per-rule hits", () => {
    const result = evaluateLogFile(LOG);
    expect(result.lineCount).toBe(4);
    // NPE rule fires on the ERROR line and maybe the stack line.
    expect(result.ruleHitCounts["null-pointer"] ?? 0).toBeGreaterThan(0);
    const flagged = result.records.filter((r) => r.flagged);
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.every((r) => r.ruleIds.length > 0)).toBe(true);
    expect(result.metrics).toBeNull(); // unlabelled
  });

  it("computes metrics against provided labels", () => {
    // Treat lines containing 'NullPointerException' as anomalous.
    const result = evaluateLogFile(LOG, (line) =>
      /NullPointerException/.test(line),
    );
    expect(result.metrics).not.toBeNull();
    expect(result.metrics!.positiveCount).toBe(1);
    expect(result.metrics!.flaggedCount).toBeGreaterThan(0);
    expect(result.metrics!.tp).toBe(1);
  });

  it("handles the empty file", () => {
    const result = evaluateLogFile("");
    expect(result.lineCount).toBe(1); // split of "" yields one empty line
    expect(result.records).toHaveLength(1);
    expect(result.ruleHitCounts).toEqual({});
  });
});