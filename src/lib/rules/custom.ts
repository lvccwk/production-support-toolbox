import { ToolError } from "@/lib/errors";
import type {
  CustomRule,
  CustomRuleInput,
  LogRule,
  RuleScope,
  RuleScopeType,
  Severity,
} from "@/types";

/**
 * Scoped custom rules (Phase 6): user/agent-registered detection rules with a
 * scope (global / systems / components) so each system or company keeps its
 * own namespace and built-in generic rules stay the shared baseline.
 *
 * Responsibilities here: input validation (regex compile + caps) and
 * converting stored custom rules into engine `LogRule`s. No DB access.
 */

export const CUSTOM_LIMITS = {
  patternsPerRule: 20,
  patternChars: 300,
  ruleNameChars: 120,
  textFieldChars: 500,
  scopeValuesPerRule: 25,
  scopeValueChars: 60,
  rootCausesPerRule: 5,
  investigationPerRule: 8,
  suggestedFixesPerRule: 5,
  longTermImprovementsPerRule: 6,
  affectedComponentsPerRule: 10,
} as const;

/** Total active custom rules cap (env-overridable). */
export function maxCustomRules(env: NodeJS.ProcessEnv = process.env): number {
  const fromEnv = Number(env.PST_MAX_CUSTOM_RULES);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : 200;
}

const SEVERITIES: Severity[] = ["Critical", "High", "Medium", "Low", "Informational"];
const SCOPE_TYPES: RuleScopeType[] = ["global", "systems", "components"];

function strArray(
  value: unknown,
  field: string,
  maxItems: number,
  maxChars: number,
  required = false,
): string[] {
  if (value === undefined) {
    if (required) throw new ToolError(`${field} is required.`);
    return [];
  }
  if (!Array.isArray(value)) throw new ToolError(`${field} must be an array.`);
  if (value.length > maxItems) {
    throw new ToolError(`${field} exceeds max ${maxItems} items.`);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") throw new ToolError(`${field} entries must be text.`);
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (trimmed.length > maxChars) {
      throw new ToolError(`${field} entry exceeds max ${maxChars} chars.`);
    }
    out.push(trimmed);
  }
  return out;
}

/**
 * Validate and normalise a custom-rule input. Compiles every pattern —
 * invalid regexes are rejected with the offending index. Throws ToolError.
 */
export function validateCustomRuleInput(raw: Partial<CustomRuleInput>): CustomRuleInput {
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, CUSTOM_LIMITS.ruleNameChars) : "";
  if (!name) throw new ToolError("Rule name is required.");

  const patterns = strArray(raw.patterns, "patterns", CUSTOM_LIMITS.patternsPerRule, CUSTOM_LIMITS.patternChars, true);
  if (patterns.length === 0) throw new ToolError("At least one pattern is required.");

  // Compile-check each pattern (reject invalid regex upfront).
  patterns.forEach((pattern, index) => {
    try {
      new RegExp(pattern);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "invalid regex";
      throw new ToolError(`Invalid pattern #${index + 1}: ${reason}`);
    }
  });

  const severity = raw.severity;
  if (typeof severity !== "string" || !SEVERITIES.includes(severity as Severity)) {
    throw new ToolError("Invalid severity.");
  }

  const scopeType = raw.scope?.type ?? "global";
  if (!SCOPE_TYPES.includes(scopeType)) {
    throw new ToolError("Invalid scope type (global | systems | components).");
  }
  const scopeValues = strArray(
    raw.scope?.values,
    "scope.values",
    CUSTOM_LIMITS.scopeValuesPerRule,
    CUSTOM_LIMITS.scopeValueChars,
    scopeType !== "global",
  );
  if ((scopeType === "systems" || scopeType === "components") && scopeValues.length === 0) {
    throw new ToolError(`scope.values are required for scope "${scopeType}".`);
  }
  const scope: RuleScope =
    scopeType === "global" ? { type: "global", values: [] } : { type: scopeType, values: scopeValues };

  return {
    name,
    scope,
    patterns,
    severity: severity as Severity,
    affectedComponents: strArray(raw.affectedComponents, "affectedComponents", CUSTOM_LIMITS.affectedComponentsPerRule, CUSTOM_LIMITS.textFieldChars),
    rootCauses: strArray(raw.rootCauses, "rootCauses", CUSTOM_LIMITS.rootCausesPerRule, CUSTOM_LIMITS.textFieldChars),
    investigation: strArray(raw.investigation, "investigation", CUSTOM_LIMITS.investigationPerRule, CUSTOM_LIMITS.textFieldChars),
    suggestedFixes: strArray(raw.suggestedFixes, "suggestedFixes", CUSTOM_LIMITS.suggestedFixesPerRule, CUSTOM_LIMITS.textFieldChars),
    longTermImprovements: strArray(raw.longTermImprovements, "longTermImprovements", CUSTOM_LIMITS.longTermImprovementsPerRule, CUSTOM_LIMITS.textFieldChars),
    active: raw.active !== false,
  };
}

/** Does a rule's scope apply to the given analysis context? */
export function scopeMatches(
  scope: RuleScope,
  context: { system?: string; components: string[] },
): boolean {
  if (scope.type === "global") return true;
  const values = scope.values.map((v) => v.toLowerCase());
  const matchAny = (haystack: string[]): boolean =>
    haystack.some((h) => values.includes(h.toLowerCase()));
  if (scope.type === "systems") {
    if (!context.system) return false;
    return values.includes(context.system.toLowerCase());
  }
  return matchAny(context.components);
}

/** Convert stored custom rules into engine LogRules (id namespaced). */
export function toLogRules(customRules: CustomRule[]): LogRule[] {
  return customRules
    .filter((rule) => rule.active)
    .map((rule) => ({
      id: `custom:${rule.id}`,
      name: rule.name,
      errorType: "Custom Error" as const,
      baseSeverity: rule.severity,
      patterns: rule.patterns.map((pattern) => new RegExp(pattern)),
      affectedComponents: rule.affectedComponents,
      rootCauses: rule.rootCauses,
      investigation: rule.investigation,
      suggestedFixes: rule.suggestedFixes,
      longTermImprovements: rule.longTermImprovements,
    }));
}