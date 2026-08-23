import { NextRequest } from "next/server";
import { ToolError } from "@/lib/errors";
import {
  base64Decode,
  base64Encode,
  urlDecode,
  urlEncode,
  urlEncodePath,
} from "@/lib/encoding/tools";
import { withApi } from "@/lib/api/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tools/encoding — agent-facing Base64 / URL toolbox.
 * Body: { "input": "...", "action": "base64-encode|base64-decode|url-encode|url-decode|url-encode-path" }
 */
export async function POST(request: NextRequest) {
  return withApi(request, { route: "/api/tools/encoding" }, async () => {
    const raw = (await request.json()) as { input?: unknown; action?: unknown };
    if (typeof raw.input !== "string" || !raw.input.trim()) {
      throw new ToolError("Please provide input text.");
    }
    switch (raw.action) {
      case "base64-encode":
        return { output: base64Encode(raw.input) };
      case "base64-decode":
        return { output: base64Decode(raw.input) };
      case "url-encode":
        return { output: urlEncode(raw.input) };
      case "url-decode":
        return { output: urlDecode(raw.input) };
      case "url-encode-path":
        return { output: urlEncodePath(raw.input) };
      default:
        throw new ToolError(
          "Unknown action. Use base64-encode, base64-decode, url-encode, url-decode or url-encode-path.",
        );
    }
  });
}