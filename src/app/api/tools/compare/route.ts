import { NextRequest } from "next/server";
import { ToolError } from "@/lib/errors";
import { compareLogs } from "@/lib/log-comparison/comparator";
import { toolErrorResponse, toolOk } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tools/compare — agent-facing log comparison.
 * Body: { "before": "...", "after": "..." }
 */
export async function POST(request: NextRequest) {
  try {
    const raw = (await request.json()) as { before?: unknown; after?: unknown };
    if (typeof raw.before !== "string" || !raw.before.trim()) {
      throw new ToolError("Please provide the 'before' log.");
    }
    if (typeof raw.after !== "string" || !raw.after.trim()) {
      throw new ToolError("Please provide the 'after' log.");
    }
    return toolOk(compareLogs(raw.before, raw.after));
  } catch (error) {
    return toolErrorResponse(error);
  }
}