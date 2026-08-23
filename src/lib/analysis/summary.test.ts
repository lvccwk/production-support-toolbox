import { describe, expect, it } from "vitest";
import { buildLogSummary } from "./summary";

describe("buildLogSummary", () => {
  it("ranks error types and counts rules uncapped", () => {
    const lines = Array.from(
      { length: 20 },
      (_, i) => `2026-08-21 10:15:22 ERROR task${i} timeout waiting for reply`,
    );
    const summary = buildLogSummary(lines.join("\n"));
    expect(summary.totalLines).toBe(20);
    expect(summary.flaggedLines).toBe(20);
    expect(summary.topErrorTypes[0]?.type).toBe("Timeout");
    expect(summary.topErrorTypes[0]?.hits).toBe(20);
    expect(summary.ruleHits.find((r) => r.ruleId === "timeout")?.hits).toBe(20);
  });

  it("aggregates levels across all lines", () => {
    const log = [
      "2026-08-21 10:00:00 INFO start",
      "2026-08-21 10:00:01 WARN slow",
      "2026-08-21 10:00:02 ERROR boom",
      "2026-08-21 10:00:03 ERROR boom again",
      "2026-08-21 10:00:04 INFO end",
    ].join("\n");
    const summary = buildLogSummary(log);
    expect(summary.levelCounts).toContainEqual({ key: "INFO", hits: 2 });
    expect(summary.levelCounts).toContainEqual({ key: "ERROR", hits: 2 });
    expect(summary.levelCounts).toContainEqual({ key: "WARN", hits: 1 });
  });

  it("builds a per-minute time distribution (spike detection)", () => {
    const log = [
      "2026-08-21 10:00:00 ERROR PaymentBatch job failed timeout",
      "2026-08-21 10:00:00 ERROR PaymentBatch job failed timeout",
      "2026-08-21 10:00:59 ERROR PaymentBatch job failed timeout",
      "2026-08-21 10:01:05 ERROR PaymentBatch job failed timeout",
    ].join("\n");
    const summary = buildLogSummary(log);
    const minutes = summary.timeDistribution.map((b) => b.minute);
    expect(minutes).toContain("2026-08-21 10:00");
    expect(minutes).toContain("2026-08-21 10:01");
    const first = summary.timeDistribution.find((b) => b.minute === "2026-08-21 10:00");
    expect(first?.flagged).toBe(3);
  });

  it("extracts approximate top components after the level", () => {
    const log = [
      "2026-08-21 10:00:00 ERROR PaymentBatch timeout",
      "2026-08-21 10:00:01 ERROR PaymentBatch timeout",
      "2026-08-21 10:00:02 ERROR SettlementBatch timeout",
    ].join("\n");
    const summary = buildLogSummary(log);
    expect(summary.topComponents).toContainEqual({ key: "PaymentBatch", hits: 2 });
    expect(summary.topComponents).toContainEqual({ key: "SettlementBatch", hits: 1 });
  });

  it("handles empty input", () => {
    const summary = buildLogSummary("");
    expect(summary.totalLines).toBe(1); // split("") yields one empty line
    expect(summary.flaggedLines).toBe(0);
    expect(summary.topErrorTypes).toEqual([]);
  });
});