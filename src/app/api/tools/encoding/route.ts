import { NextRequest } from "next/server";
import { withApi } from "@/lib/api/route";
import { runEncoding } from "@/lib/tools/runners";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tools/encoding — agent-facing Base64 / URL toolbox.
 * Body: { "input": "...", "action": "base64-encode|base64-decode|url-encode|url-decode|url-encode-path" }
 * Implementation lives in src/lib/tools/runners.ts (shared with the MCP server).
 */
export async function POST(request: NextRequest) {
  return withApi(request, { route: "/api/tools/encoding" }, async () => {
    const raw = (await request.json()) as { input?: unknown; action?: unknown };
    return runEncoding({
      input: String(raw.input ?? ""),
      action: typeof raw.action === "string" ? raw.action : "",
    });
  });
}