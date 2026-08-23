import type {
  ErrorType,
  EvidenceLine,
  ExtractedLogInfo,
  LogAnalysis,
  LogRule,
  Severity,
} from "@/types";
import { SEVERITY_ORDER } from "@/types";
import { extractLogInfo } from "@/lib/log-parser/parser";
import { RULES } from "./rules";
import { GENERIC_INVESTIGATION_ZH, RULE_ZH, UNKNOWN_ZH } from "./zh";
import { triageUnknownError } from "./triage";

/**
 * Rule-based log analysis engine (sections 4 & 5). Pure and deterministic:
 * given log text + extracted info it produces severity, error types, likely
 * root causes, investigation steps, suggested fixes and long-term
 * improvements. No AI API, no network, no I/O.
 *
 * Detection is line-scoped: a rule matches when any log line matches any of
 * its patterns, and the matching lines become the rule's evidence.
 */

const CRITICAL_LEVEL_WORDS = /\b(FATAL|SEVERE|CRITICAL)\b/i;
const OUTAGE_WORDS =
  /\b(production down|site down|outage|downtime|service unavailable|major incident)\b/i;
const ERROR_LEVEL_LINE_RE = /\b(ERROR|SEVERE|FATAL|CRITICAL)\b/i;

/**
 * Generic checks are only appended AFTER the matched rules' own steps and
 * never when no rule matched. At most GENERIC_TAIL_MAX, each marked
 * `[generic]` so the reader can tell they are generic heuristics.
 */
const GENERIC_INVESTIGATION = [
  "Check input data.",
  "Check recent deployment.",
  "Check upstream application.",
  "Review database result.",
  "Check related logs.",
];
const GENERIC_TAIL_MAX = 2;

const UNKNOWN_LONG_TERM =
  "Add a new rule for this error pattern so it is recognised next time.";
const UNKNOWN_FIX_SEARCH =
  "Search the exact error text in the codebase and related logs.";
const UNKNOWN_FIX_CLIENT =
  "Validate the request payload, authentication and permissions of the rejected call.";
const UNKNOWN_FIX_SERVER =
  "Check the receiving service's health and logs, then trace the upstream call chain.";

const MAX_EVIDENCE_LINES_PER_RULE = 8;
const DENSITY_ESCALATION_LINES = 5;
const MULTI_RULE_ESCALATION_COUNT = 4;

function rank(severity: Severity): number {
  return SEVERITY_ORDER[severity];
}

function maxSeverity(a: Severity, b: Severity): Severity {
  return rank(a) >= rank(b) ? a : b;
}

/** Raise severity by exactly one step (Critical stays Critical). */
function escalate(severity: Severity): Severity {
  switch (severity) {
    case "Informational":
      return "Low";
    case "Low":
      return "Medium";
    case "Medium":
      return "High";
    default:
      return "Critical";
  }
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function dedupeStrings(items: string[], max = 20): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = norm(item).slice(0, 60);
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

/** Match rules against the log lines, collecting per-rule evidence. */
function matchRules(
  text: string,
  rules: LogRule[],
): Array<{ rule: LogRule; evidence: EvidenceLine[] }> {
  const lines = text.split(/\r?\n/);
  const out: Array<{ rule: LogRule; evidence: EvidenceLine[] }> = [];
  for (const rule of rules) {
    const evidence: EvidenceLine[] = [];
    for (let i = 0; i < lines.length && evidence.length < MAX_EVIDENCE_LINES_PER_RULE; i++) {
      const line = lines[i];
      if (rule.patterns.some((pattern) => pattern.test(line))) {
        evidence.push({ line: i + 1, text: line.trim() });
      }
    }
    if (evidence.length > 0) out.push({ rule, evidence });
  }
  return out;
}

/** Generic checks that are not already covered by the rules' own steps. */
function genericTail(existing: string[]): string[] {
  const seen = new Set(existing.map(norm));
  const out: string[] = [];
  for (const item of GENERIC_INVESTIGATION) {
    if (seen.has(norm(item))) continue;
    out.push(`[generic] ${item}`);
    if (out.length >= GENERIC_TAIL_MAX) break;
  }
  return out;
}

/** Traditional Chinese mirror of genericTail. */
function genericTailZh(existingEn: string[]): string[] {
  const seen = new Set(existingEn.map(norm));
  const out: string[] = [];
  for (const item of GENERIC_INVESTIGATION) {
    if (seen.has(norm(item))) continue;
    out.push(`[通用] ${GENERIC_INVESTIGATION_ZH[item] ?? item}`);
    if (out.length >= GENERIC_TAIL_MAX) break;
  }
  return out;
}

/**
 * Analyse a log. `info` may be produced by extractLogInfo(text); the function
 * never throws. `extraRules` (e.g. scoped custom rules) are evaluated AFTER
 * the built-in catalogue; any matched rule prevents the Unknown-Error triage.
 */
export function analyzeLog(
  text: string,
  info: ExtractedLogInfo,
  extraRules: LogRule[] = [],
): LogAnalysis {
  const matches = matchRules(text, [...RULES, ...extraRules]);
  const matched = matches.map((m) => m.rule);

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

  if (isUnknown) severity = maxSeverity(severity, "Medium");
  const hasFatalLevel = info.levels.some((l) => CRITICAL_LEVEL_WORDS.test(l));
  if (hasFatalLevel) severity = maxSeverity(severity, "Critical");
  if (OUTAGE_WORDS.test(text)) severity = maxSeverity(severity, "High");
  if (info.httpStatuses.some((code) => code >= 500)) {
    severity = maxSeverity(severity, "High");
  }

  // Context-driven escalation (deterministic):
  // - many distinct rules firing at once,
  // - many error-level lines in the log.
  const errorLineCount = text
    .split(/\r?\n/)
    .filter((line) => ERROR_LEVEL_LINE_RE.test(line)).length;
  if (matched.length >= MULTI_RULE_ESCALATION_COUNT) {
    severity = escalate(severity);
  }
  if (errorLineCount >= DENSITY_ESCALATION_LINES) {
    severity = escalate(severity);
  }

  // --- unknown-error triage ----------------------------------------------
  const triage = isUnknown ? triageUnknownError(info) : null;

  // --- affected components ----------------------------------------------
  const ruleComponents = matched.flatMap((r) => r.affectedComponents);
  const affectedComponents = dedupeStrings([...info.components, ...ruleComponents]);

  // --- root causes -------------------------------------------------------
  const contextualCauses: string[] = [];
  const contextualCausesZh: string[] = [];
  if (info.httpStatuses.length > 0) {
    contextualCauses.push(
      `Downstream component returned HTTP ${info.httpStatuses.join(", ")}.`,
    );
    contextualCausesZh.push(`下游元件回傳 HTTP ${info.httpStatuses.join(", ")}。`);
  }
  const sourceSymbol = info.sources[0]?.symbol ?? null;
  if (sourceSymbol && errorTypes.includes("NullPointerException")) {
    contextualCauses.push(
      `Unexpected null value encountered in ${sourceSymbol} (see source line).`,
    );
    contextualCausesZh.push(`在 ${sourceSymbol} 遇到非預期的 null 數值（見來源行）。`);
  }
  const rootCauses = dedupeStrings([
    ...contextualCauses,
    ...matched.flatMap((r) => r.rootCauses),
    ...(triage ? triage.causes : []),
  ]);
  const rootCausesZh = dedupeStrings([
    ...contextualCausesZh,
    ...matched.flatMap((r) => RULE_ZH[r.id]?.rootCausesZh ?? r.rootCauses),
    ...(triage ? (triage.causesZh ?? triage.causes) : []),
  ]);

  // --- immediate investigation -------------------------------------------
  const ruleInvestigation = matched.flatMap((r) => r.investigation);
  const immediateInvestigation = dedupeStrings([
    ...ruleInvestigation,
    ...(triage ? triage.investigation : genericTail(ruleInvestigation)),
  ]);
  const immediateInvestigationZh = dedupeStrings([
    ...matched.flatMap((r) => RULE_ZH[r.id]?.investigationZh ?? r.investigation),
    ...(triage
      ? (triage.investigationZh ?? triage.investigation)
      : genericTailZh(ruleInvestigation)),
  ]);

  // --- suggestions -------------------------------------------------------
  let suggestedFixes: string[];
  let suggestedFixesZh: string[];
  if (matched.length > 0) {
    suggestedFixes = dedupeStrings(matched.flatMap((r) => r.suggestedFixes));
    suggestedFixesZh = dedupeStrings(
      matched.flatMap((r) => RULE_ZH[r.id]?.suggestedFixesZh ?? r.suggestedFixes),
    );
  } else if (triage) {
    const fixes = [UNKNOWN_FIX_SEARCH];
    const fixesZh = [UNKNOWN_ZH.fixes];
    if (triage.httpDirection === "client") {
      fixes.unshift(UNKNOWN_FIX_CLIENT);
      fixesZh.unshift(UNKNOWN_ZH.fixClient);
    }
    if (triage.httpDirection === "server") {
      fixes.unshift(UNKNOWN_FIX_SERVER);
      fixesZh.unshift(UNKNOWN_ZH.fixServer);
    }
    suggestedFixes = dedupeStrings(fixes);
    suggestedFixesZh = dedupeStrings(fixesZh);
  } else {
    suggestedFixes = [UNKNOWN_FIX_SEARCH];
    suggestedFixesZh = [UNKNOWN_ZH.fixes];
  }

  const longTermImprovements = dedupeStrings([
    ...matched.flatMap((r) => r.longTermImprovements),
    ...(matched.length === 0 && isUnknown ? [UNKNOWN_LONG_TERM] : []),
  ]);
  const longTermImprovementsZh = dedupeStrings([
    ...matched.flatMap((r) => RULE_ZH[r.id]?.longTermImprovementsZh ?? r.longTermImprovements),
    ...(matched.length === 0 && isUnknown ? [UNKNOWN_ZH.longTerm] : []),
  ]);

  return {
    severity,
    errorTypes,
    affectedComponents,
    rootCauses,
    rootCausesZh,
    immediateInvestigation,
    immediateInvestigationZh,
    suggestedFixes,
    suggestedFixesZh,
    longTermImprovements,
    longTermImprovementsZh,
    matchedRuleIds: matched.map((r) => r.id),
    matchedEvidence: matches.map(({ rule, evidence }) => ({
      ruleId: rule.id,
      ruleName: rule.name,
      evidence,
    })),
    unknownTriage: triage,
  };
}

/** Convenience: parse + analyse a raw log string in one call. */
export function analyzeLogText(text: string): LogAnalysis {
  return analyzeLog(text, extractLogInfo(text));
}