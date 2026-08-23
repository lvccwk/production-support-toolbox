import { NextRequest } from "next/server";
import { ToolError } from "@/lib/errors";
import { formatJson, minifyJson, searchJson, validateJson } from "@/lib/json/jsonTools";
import { withApi } from "@/lib/api/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tools/json — agent-facing JSON toolbox.
 * Body: { "input": "...", "action": "format|validate|minify|search", "query": "?" }
 */
export async function POST(request: NextRequest) {
  return withApi(request, { route: "/api/tools/json" }, async () => {
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
        return { output: formatJson(raw.input) };
      case "minify":
        return { output: minifyJson(raw.input) };
      case "validate":
        return validateJson(raw.input);
      case "search": {
        const query = typeof raw.query === "string" ? raw.query : "";
        return { hits: searchJson(raw.input, query) };
      }
      default:
        throw new ToolError("Unknown action. Use format, validate, minify or search.");
    }
  });
}