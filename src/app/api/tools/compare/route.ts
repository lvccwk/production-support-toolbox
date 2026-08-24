import { NextRequest } from "next/server";
import { withApi } from "@/lib/api/route";
import { runCompare } from "@/lib/tools/runners";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tools/compare — agent-facing log comparison.
 * Body: { "before": "...", "after": "..." }
 * Implementation lives in src/lib/tools/runners.ts (shared with the MCP server).
 */
export async function POST(request: NextRequest) {
  return withApi(request, { route: "/api/tools/compare" }, async () => {
    const raw = (await request.json()) as { before?: unknown; after?: unknown };
    return runCompare(String(raw.before ?? ""), String(raw.after ?? ""));
  });
}