import { NextRequest, NextResponse } from "next/server";
import { ToolError } from "@/lib/errors";
import { extractLogInfo } from "@/lib/log-parser/parser";
import { analyzeLog } from "@/lib/rules/engine";
import { scopeMatches, toLogRules } from "@/lib/rules/custom";
import { redactSensitiveValues } from "@/lib/llm/redact";
import { parseLogsInput } from "@/lib/llm/logs";
import { loadIncidentDossier } from "@/lib/llm/dossier";
import { listCustomRules } from "@/lib/database/customRules";
import { buildLogSummary } from "@/lib/analysis/summary";
import {
  buildFallbackContext,
  resolveFallbackOptions,
  runFallback,
} from "@/lib/llm/fallback";
import type { ErrorType } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tools/analyze — AGENT-FACING log analysis (Hybrid Pattern).
 *
 * Deterministic rule engine first: severity, evidence, extracted fields,
 * quantitative summary, incident dossier — local, free, immediate. When NO
 * rule matches, the OPT-IN AI fallback (PST_AI_FALLBACK=true + key) RUNS
 * AUTOMATICALLY and fills a structured bilingual analysis of the same masked
 * context (analysisSource: "ai-fallback"); failures degrade back to the rule
 * result. Response also reports aiFallbackConfigured so clients can tell
 * "not enabled" (config hint) apart from "enabled but failed" (retry).
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

    // Scoped custom rules: only rules whose scope matches this analysis run.
    const customRules = toLogRules(
      listCustomRules(true).filter((rule) =>
        scopeMatches(rule.scope, {
          system: system ?? undefined,
          components: info.components,
        }),
      ),
    );

    const analysis = analyzeLog(masked.text, info, customRules);
    const dossier = loadIncidentDossier(system);
    const fallbackOptions = resolveFallbackOptions(process.env);

    // Hybrid fallback: no rule matched -> optional AI fills the analysis.
    let analysisSource: "rules" | "ai-fallback" = "rules";
    let aiFallback: {
      cached: boolean;
      durationMs?: number;
      model?: string | null;
      confidence: number;
    } | null = null;
    let aiFallbackError: string | null = null;

    if (analysis.matchedRuleIds.length === 0) {
      if (fallbackOptions.enabled) {
        const outcome = await runFallback(
          {
            lines: buildFallbackContext(masked.text),
            levels: info.levels,
            components: info.components,
            exceptions: info.exceptions,
            httpStatuses: info.httpStatuses,
          },
          fallbackOptions,
        );
        if (outcome.ok && outcome.analysis) {
          const fb = outcome.analysis;
          analysisSource = "ai-fallback";
          analysis.severity = fb.severity;
          analysis.errorTypes = fb.errorTypes as unknown as ErrorType[];
          analysis.rootCauses = fb.rootCauses;
          analysis.rootCausesZh = fb.rootCausesZh;
          analysis.immediateInvestigation = fb.immediateInvestigation;
          analysis.immediateInvestigationZh = fb.immediateInvestigationZh;
          analysis.suggestedFixes = fb.suggestedFixes;
          analysis.suggestedFixesZh = fb.suggestedFixesZh;
          analysis.longTermImprovements = fb.longTermImprovements;
          analysis.longTermImprovementsZh = fb.longTermImprovementsZh;
          aiFallback = {
            cached: outcome.cached ?? false,
            durationMs: outcome.durationMs,
            model: outcome.model,
            confidence: fb.confidence,
          };
        } else {
          aiFallbackError = outcome.error ?? "AI fallback unavailable.";
        }
      } else {
        aiFallbackError =
          "AI fallback disabled (set PST_AI_FALLBACK=true and OPENROUTER_API_KEY).";
      }
    }

    const a = analysis;
    return NextResponse.json({
      ok: true,
      data: {
        severity: a.severity,
        errorTypes: a.errorTypes,
        affectedComponents: a.affectedComponents,
        rootCauses: a.rootCauses,
        rootCausesZh: a.rootCausesZh ?? a.rootCauses,
        immediateInvestigation: a.immediateInvestigation,
        immediateInvestigationZh: a.immediateInvestigationZh ?? a.immediateInvestigation,
        suggestedFixes: a.suggestedFixes,
        suggestedFixesZh: a.suggestedFixesZh ?? a.suggestedFixes,
        longTermImprovements: a.longTermImprovements,
        longTermImprovementsZh: a.longTermImprovementsZh ?? a.longTermImprovements,
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
        appliedCustomRules: analysis.matchedRuleIds
          .filter((id) => id.startsWith("custom:"))
          .map((id) => {
            const rule = customRules.find((r) => r.id === id);
            return { id, name: rule?.name ?? id };
          }),
        summary: buildLogSummary(masked.text, customRules),
        analysisSource,
        aiFallbackConfigured: fallbackOptions.enabled,
        aiFallback,
        aiFallbackError,
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