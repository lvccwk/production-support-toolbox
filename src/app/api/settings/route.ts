import { NextRequest, NextResponse } from "next/server";
import { setSetting } from "@/lib/database/settings";
import { ToolError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown, status = 400): NextResponse {
  const message =
    error instanceof ToolError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Unexpected error.";
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * POST /api/settings — persist runtime privacy toggles.
 * Body: { masking?: boolean, audit?: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const raw = (await request.json()) as { masking?: unknown; audit?: unknown };
    if (typeof raw.masking === "boolean") {
      setSetting("privacy:masking", raw.masking ? "1" : "0");
    }
    if (typeof raw.audit === "boolean") {
      setSetting("privacy:audit", raw.audit ? "1" : "0");
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}