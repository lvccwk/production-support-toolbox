import { NextRequest } from "next/server";
import {
  deleteHistoryEntry,
  getHistoryEntry,
} from "@/lib/database/history";
import { withApi } from "@/lib/api/route";
import { ApiError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const ROOT = "/api/history/[id]";

/** GET /api/history/[id] — fetch a saved analysis (used by "re-open"). */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withApi(request, { route: ROOT, scope: "read" }, async () => {
    const id = parseId((await context.params).id);
    if (id === null) throw new ApiError("Invalid id.", "VALIDATION_ERROR");
    const entry = getHistoryEntry(id);
    if (!entry) throw ApiError.notFound("History entry not found.");
    return entry;
  });
}

/** DELETE /api/history/[id] */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withApi(request, { route: ROOT, scope: "admin" }, async () => {
    const id = parseId((await context.params).id);
    if (id === null) throw new ApiError("Invalid id.", "VALIDATION_ERROR");
    if (!deleteHistoryEntry(id)) throw ApiError.notFound("History entry not found.");
    return { deleted: true };
  });
}