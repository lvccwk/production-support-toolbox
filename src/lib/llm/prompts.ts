import type { ExtractedLogInfo, LogAnalysis } from "@/types";

/**
 * Prompt construction (Phase 3, section 7.3). The model NEVER receives the
 * raw log: it receives (a) structured facts from the parser, (b) the rule
 * engine's deterministic result, (c) redacted evidence lines. All identifier
 * VALUES are masked so user/trace ids do not leave the machine.
 */

export const ANALYSIS_JSON_SCHEMA_HINT = `
Output ONLY a JSON object (no prose) with exactly these fields:
{
  "severity": "Critical|High|Medium|Low|Informational",
  "errorTypes": ["string", ...],
  "rootCause": "1-3 sentences",
  "evidenceLines": [1, 5],
  "nextSteps": ["step", ...],
  "confidence": 0.0-1.0,
  "explanation": "reasoning based only on the provided facts"
}`;

export function buildAnalysisSystemPrompt(): string {
  return [
    "You are a senior production support engineer analysing application logs.",
    "You answer ONLY from the facts and evidence lines provided in the message — never invent line numbers, file names or components that are not listed.",
    "If the facts are insufficient, write \"unknown\" for rootCause and set confidence below 0.3.",
    "evidenceLines must reference line numbers that actually appear in the evidence section.",
    "Your severity is advisory only and must be consistent with the rule engine severity where possible.",
    "You must NOT use any tools, run any commands, or read/write files. Analysis only — answer directly.",
    "Be concise: rootCause at most 3 sentences, nextSteps at most 5 items.",
    ANALYSIS_JSON_SCHEMA_HINT,
  ].join("\n");
}

export interface AnalysisPromptInput {
  tool: string;
  info: ExtractedLogInfo;
  analysis: LogAnalysis;
  /** Redacted evidence lines with 1-based line numbers. */
  evidence: Array<{ ruleId: string; ruleName: string; lines: Array<{ line: number; text: string }> }>;
}

function maskIdentifiers(info: ExtractedLogInfo): Record<string, string> {
  return Object.fromEntries(
    Object.entries(info.identifiers).map(([key]) => [key, "[ID]"]),
  );
}

export function buildAnalysisUserPrompt(input: AnalysisPromptInput): string {
  const { info, analysis, evidence } = input;
  const facts = {
    tool: input.tool,
    levels: info.levels,
    components: info.components,
    exceptions: info.exceptions,
    sources: info.sources.map(
      (s) => `${s.symbol ? `${s.symbol} ` : ""}${s.file}${s.line ? `:${s.line}` : ""}`,
    ),
    httpStatuses: info.httpStatuses,
    identifiers: maskIdentifiers(info),
  };
  return [
    "FACTS (parsed from the log):",
    JSON.stringify(facts, null, 2),
    "",
    "RULE ENGINE RESULT (deterministic, local):",
    JSON.stringify(
      {
        severity: analysis.severity,
        errorTypes: analysis.errorTypes,
        matchedRules: analysis.matchedRuleIds,
        rootCauses: analysis.rootCauses,
      },
      null,
      2,
    ),
    "",
    "EVIDENCE LINES (1-based line numbers):",
    ...evidence.flatMap((m) => [
      `# ${m.ruleName} (${m.ruleId}):`,
      ...m.lines.map((l) => `L${l.line}: ${l.text}`),
    ]),
    "",
    "Answer with the JSON analysis only.",
  ].join("\n");
}

/**
 * Select the context that leaves the machine: first 10 lines + last 20
 * lines + rule evidence lines (±3 neighbours), capped at 300 lines and
 * 12_000 characters (middle dropped). Pure and deterministic.
 */
export function selectContextLines(
  text: string,
  evidenceLineNumbers: number[],
  limits?: { head?: number; tail?: number; maxLines?: number; maxChars?: number },
): string[] {
  const head = limits?.head ?? 10;
  const tail = limits?.tail ?? 20;
  const maxLines = limits?.maxLines ?? 300;
  const maxChars = limits?.maxChars ?? 12_000;

  const lines = text.split(/\r?\n/);
  const wanted = new Set<number>();
  for (let i = 0; i < Math.min(head, lines.length); i++) wanted.add(i);
  for (let i = Math.max(0, lines.length - tail); i < lines.length; i++) {
    wanted.add(i);
  }
  for (const lineNo of evidenceLineNumbers) {
    for (let d = -3; d <= 3; d++) {
      const index = lineNo - 1 + d;
      if (index >= 0 && index < lines.length) wanted.add(index);
    }
  }

  const indexes = [...wanted].sort((a, b) => a - b).slice(0, maxLines);
  const out: string[] = [];
  let chars = 0;
  for (const index of indexes) {
    // Count the RENDERED line (with its L{n}: prefix) so the cap is exact.
    const rendered = `L${index + 1}: ${lines[index]}`;
    if (chars + rendered.length + 1 > maxChars && out.length > 0) break;
    chars += rendered.length + 1;
    out.push(rendered);
  }
  return out;
}