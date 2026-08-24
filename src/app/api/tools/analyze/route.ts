import { NextRequest } from "next/server";
import { withApi } from "@/lib/api/route";
import { runAnalyze } from "@/lib/tools/runners";

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
 *
 * Implementation lives in src/lib/tools/runners.ts (shared with the MCP
 * server) so the two surfaces cannot drift.
 */
export async function POST(request: NextRequest) {
  return withApi(
    request,
    { route: "/api/tools/analyze", scope: "write" },
    async () => {
      const raw = (await request.json()) as {
        log?: unknown;
        logs?: unknown;
        system?: unknown;
      };
      return runAnalyze(raw);
    },
  );
}