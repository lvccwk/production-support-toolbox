import { NextRequest, NextResponse } from "next/server";
import { importBundleJson } from "@/lib/database/export";
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
 * POST /api/import — restore a backup JSON bundle (all-or-nothing;
 * duplicates are skipped). Body: { data: string } (bundle JSON).
 */
export async function POST(request: NextRequest) {
  try {
    const raw = (await request.json()) as { data?: unknown };
    if (typeof raw.data !== "string" || !raw.data.trim()) {
      throw new ToolError("Please provide backup JSON in 'data'.");
    }
    const result = importBundleJson(raw.data);
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    return errorResponse(error);
  }
}