import { NextRequest, NextResponse } from "next/server";
import { extractLogInfo } from "@/lib/log-parser/parser";
import { analyzeLog } from "@/lib/rules/engine";
import { ToolError } from "@/lib/errors";
import { redactSensitiveValues } from "@/lib/llm/redact";
import {
  buildAnalysisSystemPrompt,
  buildAnalysisUserPrompt,
  selectContextLines,
} from "@/lib/llm/prompts";
import { validateAiAnalysis } from "@/lib/llm/schema";
import { OpenCodeProvider, resolveOpenCodeOptions } from "@/lib/llm/opencode";
import {
  analysisCacheKey,
  getCachedAnalysis,
  putCachedAnalysis,
} from "@/lib/llm/cache";
import { getDb } from "@/lib/database/db";
import { isAuditEnabled, isMaskingEnabled } from "@/lib/database/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INPUT_CHARS = 200_000;

function errorResponse(error: unknown, status = 400): NextResponse {
  const message =
    error instanceof ToolError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Unexpected error.";
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * POST /api/ai/analyze — rule-grounded AI analysis via OpenCode.
 * Guardrails: opt-in only (route always enabled, feature gate in env),
 * redaction before any text leaves, truncated context, hard timeout in the
 * adapter, JSON-schema validation of the response, per-input caching.
 * Body: { log: string }
 */
export async function POST(request: NextRequest) {
  try {
    if (process.env.PST_LLM_ENABLED !== "true") {
      throw new ToolError(
        "AI analysis is disabled. Set PST_LLM_ENABLED=true (and install OpenCode) to enable it.",
      );
    }

    const raw = (await request.json()) as { log?: unknown };
    if (typeof raw.log !== "string" || !raw.log.trim()) {
      throw new ToolError("Please provide a log to analyse.");
    }
    if (raw.log.length > MAX_INPUT_CHARS) {
      throw new ToolError(`Log too large (max ${MAX_INPUT_CHARS} chars).`);
    }
    const originalLog = raw.log;

    // 1. Redact sensitive values before anything leaves the machine.
    const masking = isMaskingEnabled();
    const redacted =
      masking === false
        ? { text: originalLog, maskedKeys: [] as string[] }
        : redactSensitiveValues(originalLog);
    const outgoingLog = redacted.text;

    // 2. Facts + rule result from the REDACTED log.
    const info = extractLogInfo(outgoingLog);
    const analysis = analyzeLog(outgoingLog, info);

    // 3. Truncated context (head + tail + evidence neighbourhoods).
    const evidenceLineNumbers = analysis.matchedEvidence.flatMap((m) =>
      m.evidence.map((e) => e.line),
    );
    const context = selectContextLines(outgoingLog, evidenceLineNumbers);
    const bytesEstimate = context.reduce((n, l) => n + l.length, 0);

    // 4. Cache check (identical input + model => zero cost).
    const options = resolveOpenCodeOptions();
    const model = options.model ?? "";
    const cacheKey = analysisCacheKey({
      tool: "log-analyzer",
      input: outgoingLog,
      model,
    });
    const cached = getCachedAnalysis(cacheKey);
    if (cached !== null) {
      const validated = validateAiAnalysis(cached);
      if (validated) {
        return NextResponse.json({
          ok: true,
          data: {
            analysis: validated,
            maskedKeys: redacted.maskedKeys,
            cached: true,
            outgoingChars: bytesEstimate,
          },
        });
      }
      // Stale/invalid cache entry: fall through and re-run.
    }

    // 5. Call OpenCode.
    const provider = new OpenCodeProvider(options);
    const prompt = buildAnalysisUserPrompt({
      tool: "log-analyzer",
      info,
      analysis,
      evidence: analysis.matchedEvidence.map((m) => ({
        ruleId: m.ruleId,
        ruleName: m.ruleName,
        lines: m.evidence,
      })),
    });
    const result = await provider.analyze({
      system: buildAnalysisSystemPrompt(),
      user: prompt,
      model: model || null,
    });

    const validated = validateAiAnalysis(result.json);
    if (!validated) {
      throw new ToolError(
        "The model returned an invalid analysis (schema check failed).",
      );
    }

    // 6. Cache + optional audit trail.
    putCachedAnalysis(cacheKey, "log-analyzer", model, validated);
    if (isAuditEnabled()) {
      getDb()
        .prepare(
          `INSERT INTO llm_calls (created_at, tool, provider, bytes_sent, redacted, ok)
           VALUES (?, ?, ?, ?, ?, 1)`,
        )
        .run(
          new Date().toISOString(),
          "log-analyzer",
          result.provider,
          bytesEstimate,
          masking ? 1 : 0,
        );
    }

    return NextResponse.json({
      ok: true,
      data: {
        analysis: validated,
        maskedKeys: redacted.maskedKeys,
        cached: false,
        outgoingChars: bytesEstimate,
        durationMs: result.durationMs,
        provider: result.provider,
        model: result.model,
      },
    });
  } catch (error) {
    return errorResponse(error, error instanceof ToolError ? 400 : 502);
  }
}