import { NextRequest } from "next/server";
import { ToolError } from "@/lib/errors";
import { cronHelper } from "@/lib/cron/parser";
import { withApi } from "@/lib/api/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tools/cron — agent-facing cron helper.
 * Body: { "expression": "0 8 * * *" }
 */
export async function POST(request: NextRequest) {
  return withApi(request, { route: "/api/tools/cron" }, async () => {
    const raw = (await request.json()) as { expression?: unknown };
    if (typeof raw.expression !== "string") {
      throw new ToolError("Please provide a cron expression.");
    }
    return cronHelper(raw.expression);
  });
}