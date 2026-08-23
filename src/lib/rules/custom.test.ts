import { describe, expect, it } from "vitest";
import {
  maxCustomRules,
  scopeMatches,
  toLogRules,
  validateCustomRuleInput,
} from "./custom";
import type { CustomRule, CustomRuleInput, RuleScope } from "@/types";

const VALID_INPUT: CustomRuleInput = {
  name: "pay-step44-timeout",
  scope: { type: "components", values: ["PaymentBatch"] },
  patterns: ["STEP44.*timeout"],
  severity: "High",
  rootCauses: ["PAY gateway timeout"],
  investigation: ["Check gateway health"],
  suggestedFixes: ["Retry batch"],
  longTermImprovements: ["Add backup gateway"],
  active: true,
};

describe("validateCustomRuleInput", () => {
  it("accepts a valid scoped rule", () => {
    const rule = validateCustomRuleInput(VALID_INPUT);
    expect(rule.name).toBe("pay-step44-timeout");
    expect(rule.scope.type).toBe("components");
    expect(rule.scope.values).toEqual(["PaymentBatch"]);
    expect(rule.active).toBe(true);
    expect(rule.suggestedFixes).toEqual(["Retry batch"]);
  });

  it("rejects invalid regexes with the offending index", () => {
    const bad = { ...VALID_INPUT, patterns: ["ok", "([unclosed"] };
    expect(() => validateCustomRuleInput(bad)).toThrowError(/Invalid pattern #2/);
  });

  it("rejects empty names and missing patterns", () => {
    expect(() => validateCustomRuleInput({ ...VALID_INPUT, name: "  " })).toThrowError(
      /name is required/i,
    );
    expect(() => validateCustomRuleInput({ ...VALID_INPUT, patterns: [] })).toThrowError(
      /pattern/i,
    );
  });

  it("requires scope values for non-global scopes", () => {
    expect(() =>
      validateCustomRuleInput({
        ...VALID_INPUT,
        scope: { type: "systems", values: [] },
      }),
    ).toThrowError(/scope\.values are required/i);
  });

  it("rejects unknown severity and scope types", () => {
    expect(() =>
      validateCustomRuleInput({ ...VALID_INPUT, severity: "Epic" as never }),
    ).toThrowError(/Invalid severity/);
    expect(() =>
      validateCustomRuleInput({
        ...VALID_INPUT,
        scope: { type: "everywhere", values: [] } as never,
      }),
    ).toThrowError(/Invalid scope type/);
  });

  it("enforces the pattern length cap", () => {
    expect(() =>
      validateCustomRuleInput({
        ...VALID_INPUT,
        patterns: ["x".repeat(301)],
      }),
    ).toThrowError(/exceeds max/);
  });
});

describe("scopeMatches", () => {
  const sys: RuleScope = { type: "systems", values: ["PaymentBatch"] };
  const comp: RuleScope = { type: "components", values: ["PaymentBatch"] };
  const global: RuleScope = { type: "global", values: [] };

  it("global always applies", () => {
    expect(scopeMatches(global, { system: "", components: [] })).toBe(true);
  });

  it("systems scope requires the system hint", () => {
    expect(scopeMatches(sys, { system: "PaymentBatch", components: [] })).toBe(true);
    expect(scopeMatches(sys, { system: "SettlementBatch", components: [] })).toBe(false);
    expect(scopeMatches(sys, { system: "", components: [] })).toBe(false);
  });

  it("components scope matches detected components case-insensitively", () => {
    expect(scopeMatches(comp, { components: ["paymentbatch"] })).toBe(true);
    expect(scopeMatches(comp, { components: ["SettlementBatch"] })).toBe(false);
  });
});

describe("toLogRules", () => {
  it("converts active custom rules into engine LogRules with namespaced ids", () => {
    const rules = toLogRules([
      {
        id: 1,
        name: "x",
        scope: { type: "global", values: [] },
        patterns: ["boom"],
        severity: "High",
        affectedComponents: [],
        rootCauses: ["cause"],
        investigation: [],
        suggestedFixes: [],
        longTermImprovements: [],
        active: true,
        createdAt: "",
        updatedAt: "",
      } satisfies CustomRule,
    ]);
    expect(rules[0]?.id).toBe("custom:1");
    expect(rules[0]?.errorType).toBe("Custom Error");
    expect(rules[0]?.rootCauses).toEqual(["cause"]);
  });

  it("skips inactive rules", () => {
    const rules = toLogRules([
      {
        id: 2,
        name: "off",
        scope: { type: "global", values: [] },
        patterns: ["x"],
        severity: "Low",
        affectedComponents: [],
        rootCauses: [],
        investigation: [],
        suggestedFixes: [],
        longTermImprovements: [],
        active: false,
        createdAt: "",
        updatedAt: "",
      } satisfies CustomRule,
    ]);
    expect(rules).toEqual([]);
  });
});

describe("maxCustomRules", () => {
  it("defaults to 200 and honours the env override", () => {
    expect(maxCustomRules({} as NodeJS.ProcessEnv)).toBe(200);
    expect(
      maxCustomRules({ PST_MAX_CUSTOM_RULES: "50" } as unknown as NodeJS.ProcessEnv),
    ).toBe(50);
  });
});