import { NextRequest, NextResponse } from "next/server";
import {
  createHistoryEntry,
  listHistory,
  validateHistoryInput,
} from "@/lib/database/history";
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

/** GET /api/history?q=... — list saved analyses (optional search). */
export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("q") ?? undefined;
    return NextResponse.json({ ok: true, data: listHistory(query) });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

/** POST /api/history — save an analysis explicitly (never automatic). */
export async function POST(request: NextRequest) {
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    const input = validateHistoryInput(raw);
    const entry = createHistoryEntry(input);
    return NextResponse.json({ ok: true, data: entry }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}