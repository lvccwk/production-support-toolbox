import { describe, expect, it } from "vitest";
import { torturePatterns, TORTURE_INPUTS } from "./torture";

describe("torturePatterns — time-bounded empirical ReDoS check (§4)", () => {
  it("runs safe patterns to completion within the budget", async () => {
    const result = await torturePatterns([
      "STEP44.*timeout",
      "(GET|POST|PUT)",
      "\\d{4}-\\d{2}-\\d{2}",
    ]);
    expect(result.ok).toBe(true);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("lets a fast safe pattern finish even under a tiny budget (budget measures execution)", async () => {
    // Budget starts at worker readiness, so trivial patterns complete even
    // with a 1ms budget — the guard is about EXECUTION time, not startup.
    const result = await torturePatterns(["fine.*pattern"], { budgetMs: 1 });
    expect(result.ok).toBe(true);
  });

  it("is deterministic about rejecting a catastrophic pattern", async () => {
    // `(a+)+$` against a long run + failing tail is exponential; with a small
    // budget the worker must be killed instead of letting the process hang.
    const result = await torturePatterns(["(a+)+$"], {
      budgetMs: 200,
      inputs: ["a".repeat(12_000) + "b"],
    });
    expect(result.ok).toBe(false);
  });

  it("passes realistic patterns quickly with the standard inputs", async () => {
    // Regression: `X.*literal` is ~quadratic in V8 on same-prefix runs; with
    // the moderate input sizes it must complete comfortably within budget.
    const result = await torturePatterns(["PaymentBatch.*timeout", "(GET|POST|PUT)"]);
    expect(result.ok).toBe(true);
    expect(result.elapsedMs ?? 0).toBeLessThan(2000);
  });

  it("exposes the standard adversarial input set for reuse (moderate sizes)", () => {
    expect(TORTURE_INPUTS.length).toBeGreaterThan(3);
    for (const input of TORTURE_INPUTS) {
      expect(input.length).toBeLessThanOrEqual(20_000);
    }
  });
});