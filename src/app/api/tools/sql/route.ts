import { NextRequest } from "next/server";
import { ToolError } from "@/lib/errors";
import { formatSql } from "@/lib/sql/sqlFormatter";
import { checkSqlSafety } from "@/lib/sql/sqlSafety";
import { analyzeSql } from "@/lib/sql/sqlAnalyzer";
import { withApi } from "@/lib/api/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tools/sql — agent-facing SQL toolbox (text-only, never executes).
 * Body: { "input": "...", "action": "format|safety|analyze" }
 */
export async function POST(request: NextRequest) {
  return withApi(request, { route: "/api/tools/sql" }, async () => {
    const raw = (await request.json()) as { input?: unknown; action?: unknown };
    if (typeof raw.input !== "string" || !raw.input.trim()) {
      throw new ToolError("Please provide SQL input.");
    }
    switch (raw.action) {
      case "format":
        return { output: formatSql(raw.input) };
      case "safety":
        return checkSqlSafety(raw.input);
      case "analyze":
        return analyzeSql(raw.input);
      default:
        throw new ToolError("Unknown action. Use format, safety or analyze.");
    }
  });
}