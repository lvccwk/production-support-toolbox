/**
 * One-off maintenance script: backfill legacy log-analyzer history entries.
 *
 * Old entries saved before the "analysis snapshot" feature existed store no
 * `analysis` object in their payload, so report columns
 * (analysisSource / matchedRuleCount / errorTypes / affectedComponents /
 * possibleRootCause / immediateInvestigation / suggestedFixes /
 * longTermImprovements) come out empty.
 *
 * For every log-analyzer row whose payload has an `input` but no `analysis`,
 * this re-runs the deterministic local rule engine on the original text and
 * rewrites the row with the exact payload shape the GUI now saves (rules
 * source — no LLM is called). Original createdAt/system are kept so ordering
 * and import dedupe stability are preserved.
 *
 * Run: npx tsx scripts/backfill-legacy-analysis.mts
 */
import { getDb, closeDb } from "../src/lib/database/db";
import { extractLogInfo } from "../src/lib/log-parser/parser";
import { analyzeLog } from "../src/lib/rules/engine";
import { createHistoryEntry, deleteHistoryEntry } from "../src/lib/database/history";
import type { HistoryRow } from "../src/lib/database/history";
import type { LogAnalysis } from "../src/types";

function safePayload(payload: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Mirror of buildSavePayload() in LogAnalyzer.tsx — rules source, no AI. */
function buildSavePayload(input: string, system: string, analysis: LogAnalysis): string {
  const base: Record<string, unknown> = {
    input,
    system,
    analysisSource: "rules",
    analysis: {
      severity: analysis.severity,
      errorTypes: analysis.errorTypes,
      affectedComponents: analysis.affectedComponents,
      rootCauses: analysis.rootCauses,
      rootCausesZh: analysis.rootCausesZh ?? null,
      immediateInvestigation: analysis.immediateInvestigation,
      immediateInvestigationZh: analysis.immediateInvestigationZh ?? null,
      suggestedFixes: analysis.suggestedFixes,
      suggestedFixesZh: analysis.suggestedFixesZh ?? null,
      longTermImprovements: analysis.longTermImprovements,
      longTermImprovementsZh: analysis.longTermImprovementsZh ?? null,
      matchedRuleIds: analysis.matchedRuleIds,
      unknownTriage: analysis.unknownTriage,
      matchedEvidence: analysis.matchedEvidence.map((m) => ({
        ruleId: m.ruleId,
        ruleName: m.ruleName,
        evidence: m.evidence.map((e) => ({ line: e.line, text: e.text })),
      })),
    },
  };
  const full = JSON.stringify(base);
  // History rejects payloads over 200k chars — same trim the GUI applies.
  if (full.length > 200_000) {
    base.analysis = {
      severity: analysis.severity,
      errorTypes: analysis.errorTypes,
      affectedComponents: analysis.affectedComponents,
      rootCauses: analysis.rootCauses,
      rootCausesZh: analysis.rootCausesZh ?? null,
      immediateInvestigation: analysis.immediateInvestigation,
      immediateInvestigationZh: analysis.immediateInvestigationZh ?? null,
      suggestedFixes: analysis.suggestedFixes,
      suggestedFixesZh: analysis.suggestedFixesZh ?? null,
      longTermImprovements: analysis.longTermImprovements,
      longTermImprovementsZh: analysis.longTermImprovementsZh ?? null,
      matchedRuleIds: analysis.matchedRuleIds,
      unknownTriage: analysis.unknownTriage,
      matchedEvidence: analysis.matchedEvidence.map((m) => ({
        ruleId: m.ruleId,
        ruleName: m.ruleName,
        evidence: m.evidence.map((e) => ({ line: e.line, text: e.text.slice(0, 200) })),
      })),
    };
    return JSON.stringify(base);
  }
  return full;
}

const db = getDb();
const rows = db
  .prepare("SELECT * FROM history WHERE tool = 'log-analyzer' ORDER BY id")
  .all() as HistoryRow[];

let backfilled = 0;
for (const row of rows) {
  const payload = safePayload(row.payload);
  const input = payload && typeof payload.input === "string" ? payload.input : null;
  const system = payload && typeof payload.system === "string" ? payload.system : "";
  if (!input || (payload && payload.analysis)) continue; // skip: no input, or already has analysis

  const info = extractLogInfo(input);
  const analysis = analyzeLog(input, info, []);
  const newPayload = buildSavePayload(input, system, analysis);
  // Same summary logic as the GUI (LogAnalyzer.tsx): exception in component.
  const component = info.components[0] ?? "log";
  const summary = info.exceptions[0]
    ? `${info.exceptions[0]} in ${component}`
    : `${component} analysis`;

  deleteHistoryEntry(row.id);
  const created = createHistoryEntry(
    { tool: "log-analyzer", system, summary, severity: analysis.severity, payload: newPayload },
    { createdAt: row.created_at },
  );
  console.log(
    `#${row.id} -> #${created.id} source=rules severity=${analysis.severity} ` +
      `errorTypes=[${analysis.errorTypes.join(", ")}] rules=${analysis.matchedRuleIds.length}`,
  );
  backfilled += 1;
}

console.log(`backfilled ${backfilled} legacy row(s)`);
closeDb();