import { NextRequest } from "next/server";
import { ToolError } from "@/lib/errors";
import { compareLogs } from "@/lib/log-comparison/comparator";
import { withApi } from "@/lib/api/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tools/compare — agent-facing log comparison.
 * Body: { "before": "...", "after": "..." }
 */
export async function POST(request: NextRequest) {
  return withApi(request, { route: "/api/tools/compare" }, async () => {
    const raw = (await request.json()) as { before?: unknown; after?: unknown };
    if (typeof raw.before !== "string" || !raw.before.trim()) {
      throw new ToolError("Please provide the 'before' log.");
    }
    if (typeof raw.after !== "string" || !raw.after.trim()) {
      throw new ToolError("Please provide the 'after' log.");
    }
    return compareLogs(raw.before, raw.after);
  });
}