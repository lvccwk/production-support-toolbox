import { NextRequest } from "next/server";
import { ToolError } from "@/lib/errors";
import { cronHelper } from "@/lib/cron/parser";
import { toolErrorResponse, toolOk } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tools/cron — agent-facing cron helper.
 * Body: { "expression": "0 8 * * *" }
 */
export async function POST(request: NextRequest) {
  try {
    const raw = (await request.json()) as { expression?: unknown };
    if (typeof raw.expression !== "string") {
      throw new ToolError("Please provide a cron expression.");
    }
    return toolOk(cronHelper(raw.expression));
  } catch (error) {
    return toolErrorResponse(error);
  }
}