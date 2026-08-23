import { NextRequest } from "next/server";
import { ToolError } from "@/lib/errors";
import { formatJson, minifyJson, searchJson, validateJson } from "@/lib/json/jsonTools";
import { toolErrorResponse, toolOk } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tools/json — agent-facing JSON toolbox.
 * Body: { "input": "...", "action": "format|validate|minify|search", "query": "?" }
 */
export async function POST(request: NextRequest) {
  try {
    const raw = (await request.json()) as {
      input?: unknown;
      action?: unknown;
      query?: unknown;
    };
    if (typeof raw.input !== "string" || !raw.input.trim()) {
      throw new ToolError("Please provide JSON input.");
    }
    const action = raw.action;
    switch (action) {
      case "format":
        return toolOk({ output: formatJson(raw.input) });
      case "minify":
        return toolOk({ output: minifyJson(raw.input) });
      case "validate":
        return toolOk(validateJson(raw.input));
      case "search": {
        const query = typeof raw.query === "string" ? raw.query : "";
        return toolOk({ hits: searchJson(raw.input, query) });
      }
      default:
        throw new ToolError(
          "Unknown action. Use format, validate, minify or search.",
        );
    }
  } catch (error) {
    return toolErrorResponse(error);
  }
}