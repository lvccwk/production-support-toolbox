import { NextRequest } from "next/server";
import { ToolError } from "@/lib/errors";
import {
  base64Decode,
  base64Encode,
  urlDecode,
  urlEncode,
  urlEncodePath,
} from "@/lib/encoding/tools";
import { toolErrorResponse, toolOk } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tools/encoding — agent-facing Base64 / URL toolbox.
 * Body: { "input": "...", "action": "base64-encode|base64-decode|url-encode|url-decode|url-encode-path" }
 */
export async function POST(request: NextRequest) {
  try {
    const raw = (await request.json()) as { input?: unknown; action?: unknown };
    if (typeof raw.input !== "string" || !raw.input.trim()) {
      throw new ToolError("Please provide input text.");
    }
    switch (raw.action) {
      case "base64-encode":
        return toolOk({ output: base64Encode(raw.input) });
      case "base64-decode":
        return toolOk({ output: base64Decode(raw.input) });
      case "url-encode":
        return toolOk({ output: urlEncode(raw.input) });
      case "url-decode":
        return toolOk({ output: urlDecode(raw.input) });
      case "url-encode-path":
        return toolOk({ output: urlEncodePath(raw.input) });
      default:
        throw new ToolError(
          "Unknown action. Use base64-encode, base64-decode, url-encode, url-decode or url-encode-path.",
        );
    }
  } catch (error) {
    return toolErrorResponse(error);
  }
}