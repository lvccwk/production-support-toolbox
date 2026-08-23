import { describe, expect, it } from "vitest";
import { assertPatternsSafe, inspectPattern } from "./regexSafety";
import { validateCustomRuleInput } from "./custom";
import type { CustomRuleInput } from "@/types";

const VALID_INPUT: CustomRuleInput = {
  name: "pay-step44-timeout",
  scope: { type: "components", values: ["PaymentBatch"] },
  patterns: ["STEP44.*timeout"],
  severity: "High",
};

describe("inspectPattern — known ReDoS traps (Engineering Review §4)", () => {
  const MUST_REJECT: Array<{ pattern: string; why: string }> = [
    { pattern: "(a+)+$", why: "nested quantifier (inner + inside outer +)" },
    { pattern: "^(a+)+$", why: "anchored nested quantifier" },
    { pattern: "(a*)*", why: "inner * inside outer *" },
    { pattern: "(a?)?", why: "inner ? inside outer ?" },
    { pattern: "(\\w+)+", why: "character class quantifier inside group quantifier" },
    { pattern: "([a-z]+)+", why: "class + inside group +" },
    { pattern: "(a|aa)+$", why: "alternation branches share first char, quantified" },
    { pattern: "(a|ab)*", why: "shared prefix alternation with zero-length outer" },
    { pattern: "(ab|a)+", why: "shared first char (a) in quantified alternation" },
    { pattern: "((a+)+)+", why: "nested chain" },
    { pattern: "(a+){3,}", why: "unbounded outer over quantified group" },
    { pattern: "(\\d+)\\1+", why: "backreference over quantified group" },
    { pattern: "(?<x>a+)\\k<x>+", why: "named backreference" },
  ];

  for (const { pattern, why } of MUST_REJECT) {
    it(`rejects ${pattern} (${why})`, () => {
      const safety = inspectPattern(pattern);
      expect(safety.ok).toBe(false);
      expect(safety.reason).toBeTruthy();
    });
  }

  const MUST_ACCEPT: Array<{ pattern: string; why: string }> = [
    { pattern: "STEP44.*timeout", why: "simple literal + wildcard" },
    { pattern: "ERROR|FATAL", why: "alternation, not quantified" },
    { pattern: "(GET|POST|PUT)\\s", why: "quantified? no — grouped alternation, distinct first chars, group not quantified" },
    { pattern: "\\d{4}-\\d{2}-\\d{2}", why: "bounded quantifiers only" },
    { pattern: "(\\d{1,3}\\.){3}\\d{1,3}", why: "exact small outer bound {3} over quantified group = safe" },
    { pattern: "(?i)payment.*timeout", why: "flags + literal" },
    { pattern: "[a-z]+-[0-9]+", why: "class quantifiers, no groups" },
    { pattern: "batch_(step|stage)_\\d+", why: "alternation of plain literals (no shared first char)" },
    { pattern: "\\b(timeout|retry)\\b", why: "bounded word alternatives, group not quantified" },
  ];

  for (const { pattern, why } of MUST_ACCEPT) {
    it(`accepts ${pattern} (${why})`, () => {
      const safety = inspectPattern(pattern);
      expect(safety.ok, `expected ok for ${pattern} — reason: ${safety.reason}`).toBe(true);
    });
  }
});

describe("assertPatternsSafe → registration (validateCustomRuleInput)", () => {
  it("rejects (a+)+$ with an actionable message naming the pattern index", () => {
    expect(() =>
      validateCustomRuleInput({ ...VALID_INPUT, patterns: ["ok.*pattern", "(a+)+$"] }),
    ).toThrowError(/Unsafe pattern #2/);
  });

  it("rejects backreferences even when syntactically valid", () => {
    expect(() =>
      validateCustomRuleInput({ ...VALID_INPUT, patterns: ["(\\w+) \\1"] }),
    ).toThrowError(/Backreferences/);
  });

  it("keeps normal patterns working (no false positives on realistic rules)", () => {
    expect(
      validateCustomRuleInput({
        ...VALID_INPUT,
        patterns: ["STEP44.*timeout", "(PaymentBatch|Settlement).*failed"],
      }).patterns.length,
    ).toBe(2);
  });

  it("still rejects plain syntax errors with the offending index", () => {
    expect(() =>
      validateCustomRuleInput({ ...VALID_INPUT, patterns: ["([unclosed"] }),
    ).toThrowError(/Invalid pattern #1/);
  });

  it("documents the supported subset through the error reason", () => {
    const safety = inspectPattern("(a+)+");
    expect(safety.reason).toContain("catastrophic backtracking");
  });

  it("assertPatternsSafe throws ToolError for an unsafe list", () => {
    expect(() => assertPatternsSafe(["fine.*pattern", "([a-z]+)+"])).toThrowError(
      /Unsafe pattern #2/,
    );
  });
});