import { NextRequest } from "next/server";
import { withApi } from "@/lib/api/route";
import { runTimestamp } from "@/lib/tools/runners";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tools/timestamp — agent-facing timestamp conversion.
 * Body: { "input": "...", "timezone": "Asia/Hong_Kong (optional)" }
 * Implementation lives in src/lib/tools/runners.ts (shared with the MCP server).
 */
export async function POST(request: NextRequest) {
  return withApi(request, { route: "/api/tools/timestamp" }, async () => {
    const raw = (await request.json()) as { input?: unknown; timezone?: unknown };
    return runTimestamp({
      input: String(raw.input ?? ""),
      timezone: typeof raw.timezone === "string" ? raw.timezone : undefined,
    });
  });
}