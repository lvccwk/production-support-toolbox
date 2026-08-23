import { describe, expect, it } from "vitest";
import { analyzeLogText, analyzeLog } from "./engine";
import { extractLogInfo } from "@/lib/log-parser/parser";
import type { LogRule } from "@/types";

describe("engine runtime-pattern defense (§4)", () => {
  it("never crashes the request when a pattern throws at runtime", () => {
    // A pattern object whose test() throws — simulates an exotic pattern
    // failure. The engine must skip the rule, report it, and return normally.
    const throwingPattern = {
      test: () => {
        throw new Error("internal matcher failure");
      },
    } as unknown as RegExp;

    const extraRules: LogRule[] = [
      {
        id: "custom:bad",
        name: "exploding-rule",
        errorType: "Custom Error",
        baseSeverity: "High",
        patterns: [throwingPattern],
        affectedComponents: [],
        rootCauses: [],
        investigation: [],
        suggestedFixes: [],
        longTermImprovements: [],
      },
    ];

    const result = analyzeLog(
      "2026-08-21 10:00:00 ERROR PaymentBatch boom",
      extractLogInfo("2026-08-21 10:00:00 ERROR PaymentBatch boom"),
      extraRules,
    );
    expect(result.skippedRules).toEqual([
      {
        ruleId: "custom:bad",
        name: "exploding-rule",
        reason: expect.stringContaining("skipped") as unknown as string,
      },
    ]);
    // The rest of the analysis is still produced (no crash, no partial data).
    expect(result.severity).toBeDefined();
    expect(result.matchedRuleIds).toBeDefined();
  });

  it("has no skippedRules when every pattern works", () => {
    const result = analyzeLogText("2026-08-21 10:00:00 ERROR PaymentBatch boom");
    expect(result.skippedRules ?? []).toEqual([]);
  });
});