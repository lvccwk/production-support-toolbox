import { NextRequest } from "next/server";
import { ToolError } from "@/lib/errors";
import { formatSql } from "@/lib/sql/sqlFormatter";
import { checkSqlSafety } from "@/lib/sql/sqlSafety";
import { analyzeSql } from "@/lib/sql/sqlAnalyzer";
import { toolErrorResponse, toolOk } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tools/sql — agent-facing SQL toolbox (text-only, never executes).
 * Body: { "input": "...", "action": "format|safety|analyze" }
 */
export async function POST(request: NextRequest) {
  try {
    const raw = (await request.json()) as { input?: unknown; action?: unknown };
    if (typeof raw.input !== "string" || !raw.input.trim()) {
      throw new ToolError("Please provide SQL input.");
    }
    switch (raw.action) {
      case "format":
        return toolOk({ output: formatSql(raw.input) });
      case "safety":
        return toolOk(checkSqlSafety(raw.input));
      case "analyze":
        return toolOk(analyzeSql(raw.input));
      default:
        throw new ToolError("Unknown action. Use format, safety or analyze.");
    }
  } catch (error) {
    return toolErrorResponse(error);
  }
}