import { NextResponse } from "next/server";
import { getDb } from "@/lib/database/db";
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

/** POST /api/settings/clear-cache — drop all cached AI analyses. */
export async function POST() {
  try {
    const result = getDb().prepare("DELETE FROM analysis_cache").run();
    return NextResponse.json({ ok: true, data: { cleared: result.changes } });
  } catch (error) {
    return errorResponse(error, 500);
  }
}