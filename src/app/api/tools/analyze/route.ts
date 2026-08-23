import { NextRequest, NextResponse } from "next/server";
import { ToolError } from "@/lib/errors";
import { extractLogInfo } from "@/lib/log-parser/parser";
import { analyzeLog } from "@/lib/rules/engine";
import { redactSensitiveValues } from "@/lib/llm/redact";
import { parseLogsInput } from "@/lib/llm/logs";
import { loadIncidentDossier } from "@/lib/llm/dossier";
import { buildLogSummary } from "@/lib/analysis/summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tools/analyze — AGENT-FACING deterministic log analysis.
 *
 * The same parser + rule engine + incident dossier the GUI uses, exposed as
 * one stateless JSON call: input log(s) in, structured analysis out. No LLM
 * call, no DB writes, no human interaction.
 *
 * Body: { "logs": ["..."], "system": "optional hint" } (single log works too)
 * Privacy: sensitive values are masked unless PST_REDACT=off.
 */
export async function POST(request: NextRequest) {
  try {
    const raw = (await request.json()) as {
      log?: unknown;
      logs?: unknown;
      system?: unknown;
    };
    const logs = parseLogsInput(raw);
    const system = typeof raw.system === "string" ? raw.system.trim().slice(0, 100) : "";

    const masking = process.env.PST_REDACT !== "off";
    const masked = masking
      ? redactSensitiveValues(logs.join("\n"))
      : { text: logs.join("\n"), maskedKeys: [] as string[] };

    const info = extractLogInfo(masked.text);
    const analysis = analyzeLog(masked.text, info);
    const dossier = loadIncidentDossier(system);

    const a = analysis;
    return NextResponse.json({
      ok: true,
      data: {
        severity: a.severity,
        errorTypes: a.errorTypes,
        affectedComponents: a.affectedComponents,
        rootCauses: a.rootCauses,
        immediateInvestigation: a.immediateInvestigation,
        suggestedFixes: a.suggestedFixes,
        longTermImprovements: a.longTermImprovements,
        matchedRuleIds: a.matchedRuleIds,
        evidence: a.matchedEvidence,
        unknownTriage: a.unknownTriage,
        extracted: {
          timestamps: info.timestamps,
          levels: info.levels,
          components: info.components,
          identifiers: info.identifiers,
          exceptions: info.exceptions,
          sources: info.sources,
          httpStatuses: info.httpStatuses,
          stackTrace: info.stackTrace,
        },
        maskedKeys: masked.maskedKeys,
        logCount: logs.length,
        dossierCount: dossier.length,
        summary: buildLogSummary(masked.text),
      },
    });
  } catch (error) {
    const message =
      error instanceof ToolError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unexpected error.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}