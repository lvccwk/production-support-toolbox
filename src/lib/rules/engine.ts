import type {
  ErrorType,
  ExtractedLogInfo,
  LogAnalysis,
  Severity,
} from "@/types";
import { SEVERITY_ORDER } from "@/types";
import { extractLogInfo } from "@/lib/log-parser/parser";
import { RULES } from "./rules";

/**
 * Rule-based log analysis engine (sections 4 & 5). Pure and deterministic:
 * given log text + extracted info it produces severity, error types, likely
 * root causes, investigation steps, suggested fixes and long-term
 * improvements. No AI API, no network, no I/O.
 */

const GENERIC_INVESTIGATION = [
  "Check input data.",
  "Check recent deployment.",
  "Check upstream application.",
  "Review database result.",
  "Check related logs.",
];

const UNKNOWN_ERROR_CAUSES = [
  "No known rule matched this error pattern.",
  "Exception message or stack trace contains the best clues.",
];

const UNKNOWN_ERROR_FIXES = [
  "Search the exact error text in the codebase and related logs.",
  "Review the exception message details and stack frame.",
];

const UNKNOWN_ERROR_LONG_TERM = [
  "Add a new rule for this error pattern so it is recognised next time.",
];

const CRITICAL_LEVEL_WORDS = /\b(FATAL|SEVERE|CRITICAL)\b/i;
const OUTAGE_WORDS =
  /\b(production down|site down|outage|downtime|service unavailable|major incident)\b/i;

function rank(severity: Severity): number {
  return SEVERITY_ORDER[severity];
}

function maxSeverity(a: Severity, b: Severity): Severity {
  return rank(a) >= rank(b) ? a : b;
}

function dedupeStrings(items: string[], max = 20): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim().toLowerCase().slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
    if (out.length >= max) break;
  }
  return out;
}

function dedupeTypes(items: ErrorType[]): ErrorType[] {
  return [...new Set(items)];
}

/**
 * Analyse a log. `info` may be produced by extractLogInfo(text); the function
 * never throws.
 */
export function analyzeLog(text: string, info: ExtractedLogInfo): LogAnalysis {
  const matched = RULES.filter((rule) => rule.detect(text));

  // --- error types -------------------------------------------------------
  const hasErrorLevel = info.levels.some((level) =>
    /^(ERROR|SEVERE|FATAL|CRITICAL)$/i.test(level),
  );
  const isUnknown = matched.length === 0 && hasErrorLevel;
  const errorTypes = dedupeTypes([
    ...matched.map((rule) => rule.errorType),
    ...(isUnknown ? (["Unknown Error"] as ErrorType[]) : []),
  ]);

  // --- severity ----------------------------------------------------------
  let severity: Severity =
    matched.length > 0
      ? matched.map((r) => r.baseSeverity).reduce((a, b) => maxSeverity(a, b))
      : "Informational";

  // Context-driven escalation (deterministic).
  if (isUnknown) severity = maxSeverity(severity, "Medium");
  const hasFatalLevel = info.levels.some((l) =>
    CRITICAL_LEVEL_WORDS.test(l),
  );
  if (hasFatalLevel) severity = maxSeverity(severity, "Critical");
  if (OUTAGE_WORDS.test(text)) severity = maxSeverity(severity, "High");

  if (info.httpStatuses.some((code) => code >= 500)) {
    severity = maxSeverity(severity, "High");
  }

  // --- affected components ----------------------------------------------
  const ruleComponents = matched.flatMap((r) => r.affectedComponents);
  const affectedComponents = dedupeStrings([...info.components, ...ruleComponents]);

  // --- root causes -------------------------------------------------------
  const contextualCauses: string[] = [];
  if (info.httpStatuses.length > 0) {
    contextualCauses.push(
      `Downstream component returned HTTP ${info.httpStatuses.join(", ")}.`,
    );
  }
  const sourceSymbol = info.sources[0]?.symbol ?? null;
  if (sourceSymbol && errorTypes.includes("NullPointerException")) {
    contextualCauses.push(
      `Unexpected null value encountered in ${sourceSymbol} (see source line).`,
    );
  }
  const rootCauses = dedupeStrings([
    ...contextualCauses,
    ...matched.flatMap((r) => r.rootCauses),
    ...(matched.length === 0 ? UNKNOWN_ERROR_CAUSES : []),
  ]);

  // --- immediate investigation -------------------------------------------
  const immediateInvestigation = dedupeStrings([
    ...matched.flatMap((r) => r.investigation),
    ...GENERIC_INVESTIGATION,
  ]);

  // --- suggestions -------------------------------------------------------
  const suggestedFixes = dedupeStrings([
    ...matched.flatMap((r) => r.suggestedFixes),
    ...(matched.length === 0 ? UNKNOWN_ERROR_FIXES : []),
  ]);
  const longTermImprovements = dedupeStrings([
    ...matched.flatMap((r) => r.longTermImprovements),
    ...(matched.length === 0 ? UNKNOWN_ERROR_LONG_TERM : []),
  ]);

  return {
    severity,
    errorTypes,
    affectedComponents,
    rootCauses,
    immediateInvestigation,
    suggestedFixes,
    longTermImprovements,
    matchedRuleIds: matched.map((r) => r.id),
  };
}

/** Convenience: parse + analyse a raw log string in one call. */
export function analyzeLogText(text: string): LogAnalysis {
  return analyzeLog(text, extractLogInfo(text));
}
