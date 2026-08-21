import { NextRequest, NextResponse } from "next/server";
import {
  deleteHistoryEntry,
  getHistoryEntry,
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

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** GET /api/history/[id] — fetch a saved analysis (used by "re-open"). */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (id === null) return errorResponse(new ToolError("Invalid id."), 400);
    const entry = getHistoryEntry(id);
    if (!entry) return errorResponse(new ToolError("History entry not found."), 404);
    return NextResponse.json({ ok: true, data: entry });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

/** DELETE /api/history/[id] */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (id === null) return errorResponse(new ToolError("Invalid id."), 400);
    const deleted = deleteHistoryEntry(id);
    if (!deleted) return errorResponse(new ToolError("History entry not found."), 404);
    return NextResponse.json({ ok: true, data: { deleted: true } });
  } catch (error) {
    return errorResponse(error, 500);
  }
}