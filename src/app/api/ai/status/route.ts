import { spawnSync } from "node:child_process";
import { NextResponse } from "next/server";
import { resolveOpenCodeOptions } from "@/lib/llm/opencode";
import { isAuditEnabled, isMaskingEnabled } from "@/lib/database/settings";
import { getDb } from "@/lib/database/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/status — OpenCode readiness + privacy toggle state.
 * Read-only; configuration itself stays in environment variables.
 */
export async function GET() {
  const options = resolveOpenCodeOptions();
  const bin = options.bin ?? "opencode";

  let version: string | null = null;
  if (process.env.PST_LLM_ENABLED === "true") {
    const probe = spawnSync(bin, ["--version"], {
      timeout: 3000,
      encoding: "utf8",
    });
    if (probe.status === 0 && probe.stdout) {
      version = probe.stdout.trim().split(/\r?\n/)[0] ?? null;
    }
  }

  const cacheCount = (
    getDb().prepare("SELECT COUNT(*) AS n FROM analysis_cache").get() as {
      n: number;
    }
  ).n;

  return NextResponse.json({
    ok: true,
    data: {
      enabled: process.env.PST_LLM_ENABLED === "true",
      bin,
      version,
      model: options.model ?? null,
      /** Human label: configured model or "自動(未指定)". */
      modelLabel: options.model ? options.model : "自動(未指定)",
      timeoutMs: options.timeoutMs ?? 120_000,
      workDir: options.workDir ?? null,
      masking: isMaskingEnabled(),
      audit: isAuditEnabled(),
      cacheEntries: cacheCount,
    },
  });
}