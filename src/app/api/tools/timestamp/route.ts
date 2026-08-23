import { NextRequest } from "next/server";
import { ToolError } from "@/lib/errors";
import { convertTimestamp, availableTimezones } from "@/lib/timestamp/converter";
import { toolErrorResponse, toolOk } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tools/timestamp — agent-facing timestamp conversion.
 * Body: { "input": "...", "timezone": "Asia/Hong_Kong (optional)" }
 */
export async function POST(request: NextRequest) {
  try {
    const raw = (await request.json()) as { input?: unknown; timezone?: unknown };
    if (typeof raw.input !== "string" || !raw.input.trim()) {
      throw new ToolError("Please provide a timestamp.");
    }
    const timezone =
      typeof raw.timezone === "string" && raw.timezone.trim()
        ? raw.timezone.trim()
        : "Asia/Hong_Kong";
    const zones = availableTimezones();
    if (!zones.includes(timezone)) {
      throw new ToolError(`Unsupported timezone: ${timezone}`);
    }
    return toolOk(convertTimestamp(raw.input, timezone));
  } catch (error) {
    return toolErrorResponse(error);
  }
}