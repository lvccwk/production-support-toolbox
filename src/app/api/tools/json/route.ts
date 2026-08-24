import { NextRequest } from "next/server";
import { withApi } from "@/lib/api/route";
import { runJson } from "@/lib/tools/runners";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tools/json — agent-facing JSON toolbox.
 * Body: { "input": "...", "action": "format|validate|minify|search", "query": "?" }
 * Implementation lives in src/lib/tools/runners.ts (shared with the MCP server).
 */
export async function POST(request: NextRequest) {
  return withApi(request, { route: "/api/tools/json" }, async () => {
    const raw = (await request.json()) as {
      input?: unknown;
      action?: unknown;
      query?: unknown;
    };
    return runJson({
      input: String(raw.input ?? ""),
      action: typeof raw.action === "string" ? raw.action : "",
      query: typeof raw.query === "string" ? raw.query : undefined,
    });
  });
}