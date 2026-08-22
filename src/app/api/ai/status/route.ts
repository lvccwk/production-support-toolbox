import { NextResponse } from "next/server";
import { resolveOpenRouterOptions } from "@/lib/llm/openrouter";
import { isAuditEnabled, isMaskingEnabled } from "@/lib/database/settings";
import { getDb } from "@/lib/database/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/status — OpenRouter readiness + privacy toggle state.
 * Read-only; secrets stay in environment variables and are never revealed
 * (only whether they are configured).
 */
export async function GET() {
  const options = resolveOpenRouterOptions();
  const keyConfigured = Boolean(options.apiKey);
  const modelConfigured = Boolean(options.model);

  const cacheCount = (
    getDb().prepare("SELECT COUNT(*) AS n FROM analysis_cache").get() as {
      n: number;
    }
  ).n;

  return NextResponse.json({
    ok: true,
    data: {
      enabled: process.env.PST_LLM_ENABLED === "true",
      provider: "openrouter",
      configured: keyConfigured && modelConfigured,
      keyConfigured,
      modelConfigured,
      model: options.model ?? null,
      /** Human label: configured model or "自動(未指定)". */
      modelLabel: options.model ? options.model : "自動(未指定)",
      timeoutMs: options.timeoutMs ?? 120_000,
      masking: isMaskingEnabled(),
      audit: isAuditEnabled(),
      cacheEntries: cacheCount,
    },
  });
}