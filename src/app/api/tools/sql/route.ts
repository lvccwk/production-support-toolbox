import { NextRequest } from "next/server";
import { withApi } from "@/lib/api/route";
import { runSql } from "@/lib/tools/runners";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tools/sql — agent-facing SQL toolbox (text-only, never executes).
 * Body: { "input": "...", "action": "format|safety|analyze" }
 * Implementation lives in src/lib/tools/runners.ts (shared with the MCP server).
 */
export async function POST(request: NextRequest) {
  return withApi(request, { route: "/api/tools/sql" }, async () => {
    const raw = (await request.json()) as { input?: unknown; action?: unknown };
    return runSql({
      input: String(raw.input ?? ""),
      action: typeof raw.action === "string" ? raw.action : "",
    });
  });
}