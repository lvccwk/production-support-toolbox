import { NextRequest, NextResponse } from "next/server";
import { extractLogInfo } from "@/lib/log-parser/parser";
import { analyzeLog } from "@/lib/rules/engine";
import { scopeMatches, toLogRules } from "@/lib/rules/custom";
import { redactSensitiveValues } from "@/lib/llm/redact";
import { parseLogsInput } from "@/lib/llm/logs";
import { listCustomRules } from "@/lib/database/customRules";
import { withApi } from "@/lib/api/route";
import { emitMetric } from "@/lib/api/metrics";
import {
  buildFallbackContext,
  resolveFallbackOptions,
  streamFallback,
  type FallbackAnalysis,
} from "@/lib/llm/fallback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tools/analyze/stream — SSE variant of the AI fallback used by the
 * GUI. The rule engine already ran client-side (instant); this endpoint ONLY
 * streams the AI fallback for 0-match logs, pushing the model's tokens to the
 * browser as they arrive so the "loading" panel shows live progress instead
 * of a blank spinner until the full response lands.
 *
 * Events:
 *   event: phase      { phase, aiFallbackConfigured }
 *   event: delta      { text }   — incremental model output (preview only)
 *   event: ai_result  { <analysis fields>, aiFallback:{cached,model,confidence}, ... }
 *   event: error      { message }
 *   event: done       {}
 *
 * Identical privacy/cache/schema guarantees as POST /api/tools/analyze:
 * masked input, per-hash cache, strict JSON validation, hard Traditional
 * Chinese conversion, no upstream response bodies forwarded.
 */
export async function POST(request: NextRequest) {
  return withApi(
    request,
    { route: "/api/tools/analyze/stream", scope: "write" },
    async () => {
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
      const customRules = toLogRules(
        listCustomRules(true).filter((rule) =>
          scopeMatches(rule.scope, {
            system: system ?? undefined,
            components: info.components,
          }),
        ),
      );
      // Server-side confirmation that NO rule matched (the GUI already knows,
      // but we never trust the client on that).
      const analyzed = analyzeLog(masked.text, info, customRules);
      const fallbackOptions = resolveFallbackOptions(process.env);

      const encoder = new TextEncoder();
      const sse = (event: string, data: unknown): Uint8Array =>
        encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            if (analyzed.matchedRuleIds.length > 0) {
              controller.enqueue(
                sse("phase", { phase: "rules_matched", aiFallbackConfigured: fallbackOptions.enabled }),
              );
              controller.enqueue(sse("error", { message: "Rules matched — AI fallback not required." }));
              controller.enqueue(sse("done", {}));
              return;
            }

            controller.enqueue(
              sse("phase", { phase: "ai", aiFallbackConfigured: fallbackOptions.enabled }),
            );
            const started = Date.now();

            for await (const event of streamFallback(
              {
                lines: buildFallbackContext(masked.text),
                levels: info.levels,
                components: info.components,
                exceptions: info.exceptions,
                httpStatuses: info.httpStatuses,
              },
              fallbackOptions,
            )) {
              if (event.type === "delta") {
                controller.enqueue(sse("delta", { text: event.text ?? "" }));
              } else if (event.type === "result" && event.analysis) {
                emitMetric("ai_fallback", {
                  ok: true,
                  durationMs: Date.now() - started,
                  cached: event.cached ?? false,
                });
                controller.enqueue(sse("ai_result", aiResultPayload(event.analysis, event.cached ?? false, fallbackOptions.model ?? null)));
              } else if (event.type === "error") {
                emitMetric("ai_fallback", { ok: false, durationMs: Date.now() - started });
                controller.enqueue(sse("error", { message: event.error ?? "AI fallback failed." }));
              }
            }
            controller.enqueue(sse("done", {}));
          } catch {
            controller.enqueue(sse("error", { message: "AI fallback failed unexpectedly." }));
            controller.enqueue(sse("done", {}));
          } finally {
            controller.close();
          }
        },
      });

      return new NextResponse(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      });
    },
  );
}

/** Shape the GUI's ServerAnalyzeData expects for an AI-fallback result. */
function aiResultPayload(
  analysis: FallbackAnalysis,
  cached: boolean,
  model: string | null,
): Record<string, unknown> {
  return {
    analysisSource: "ai-fallback",
    severity: analysis.severity,
    errorTypes: analysis.errorTypes,
    rootCauses: analysis.rootCauses,
    rootCausesZh: analysis.rootCausesZh,
    immediateInvestigation: analysis.immediateInvestigation,
    immediateInvestigationZh: analysis.immediateInvestigationZh,
    suggestedFixes: analysis.suggestedFixes,
    suggestedFixesZh: analysis.suggestedFixesZh,
    longTermImprovements: analysis.longTermImprovements,
    longTermImprovementsZh: analysis.longTermImprovementsZh,
    aiFallback: {
      cached,
      model,
      confidence: analysis.confidence,
    },
    aiFallbackConfigured: true,
    aiFallbackError: null,
  };
}