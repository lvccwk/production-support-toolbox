import { NextRequest } from "next/server";
import { searchHttpStatus } from "@/lib/http/statusCatalog";
import { toolOk } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tools/http — agent-facing HTTP status reference search.
 * Body: { "query": "503 | gateway timeout | 4xx (optional; empty = all)" }
 */
export async function POST(request: NextRequest) {
  const raw = (await request.json().catch(() => ({}))) as { query?: unknown };
  const query = typeof raw.query === "string" ? raw.query : "";
  return toolOk({ entries: searchHttpStatus(query) });
}