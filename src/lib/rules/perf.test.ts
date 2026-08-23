import { describe, expect, it } from "vitest";
import { analyzeLogText, analyzeLog } from "./engine";
import { validateCustomRuleInput } from "./custom";
import { extractLogInfo } from "@/lib/log-parser/parser";
import type { LogRule } from "@/types";

/**
 * Performance tests (Engineering Review §10). Budgets are deliberately
 * generous (CI variance) but MEASURED: a regression that turns analysis into
 * quadratic/exponential work will blow past them.
 */

describe("engine performance budgets", () => {
  it("analyzes a large log with many custom rules well under budget", () => {
    const lines = Array.from({ length: 400 }, (_, i) => {
      const level = i % 10 === 0 ? "ERROR" : "INFO";
      // Every 50th line hits a built-in rule (NPE) so the engine has matches;
      // the rest are filler that exercises the per-line matching loop.
      if (i % 50 === 0) {
        return `2026-08-21 10:00:0${i % 10} ${level} PaymentBatch java.lang.NullPointerException at PaymentService.java:${i + 1}`;
      }
      return `2026-08-21 10:00:0${i % 10} ${level} PaymentBatch orderId=${i} STEP${i % 50} done in ${i % 100}ms`;
    }).join("\n");
    const log = `${lines}\n${lines}\n${lines}`; // ~1200 lines

    const extraRules: LogRule[] = Array.from({ length: 100 }, (_, i) => ({
      id: `custom:${i}`,
      name: `perf-rule-${i}`,
      errorType: "Custom Error",
      baseSeverity: "High",
      patterns: [new RegExp(`STEP${i % 50}.*done|perf-token-${i}`)],
      affectedComponents: [],
      rootCauses: [],
      investigation: [],
      suggestedFixes: [],
      longTermImprovements: [],
    }));

    const startedEngine = Date.now();
    const engineResult = analyzeLogText(log); // built-ins only
    const engineMs = Date.now() - startedEngine;
    expect(engineResult.matchedRuleIds.length).toBeGreaterThan(0);

    const startedRules = Date.now();
    const withRules = analyzeLog(log, extractLogInfo(log), extraRules);
    const withRulesMs = Date.now() - startedRules;
    expect(withRules.matchedRuleIds.length).toBeGreaterThan(0);

    // Generous budgets that exponential behaviour would obliterate.
    expect(engineMs).toBeLessThan(2000);
    expect(withRulesMs).toBeLessThan(4000);

    // Sanity: the custom rules contributed matches.
    expect(withRules.matchedRuleIds.some((id) => id.startsWith("custom:"))).toBe(true);
  });

  it("rejects a catastrophic pattern instantly at validation (no engine hang)", () => {
    const started = Date.now();
    expect(() =>
      validateCustomRuleInput({
        name: "evil",
        scope: { type: "global", values: [] },
        patterns: ["(a+)+$"],
        severity: "High",
      }),
    ).toThrowError(/Unsafe pattern/);
    expect(Date.now() - started).toBeLessThan(500);
  });
});