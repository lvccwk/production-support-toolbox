import { NextRequest, NextResponse } from "next/server";
import {
  createHistoryEntry,
  listHistory,
  validateHistoryInput,
} from "@/lib/database/history";
import { evaluateAlerts } from "@/lib/database/alerts";
import { withApi } from "@/lib/api/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/history?q=... — list saved analyses (optional search). */
export async function GET(request: NextRequest) {
  return withApi(request, { route: "/api/history", scope: "read" }, async () => {
    const query = request.nextUrl.searchParams.get("q") ?? undefined;
    return listHistory(query);
  });
}

/**
 * POST /api/history — save an analysis explicitly (never automatic).
 *
 * Alert rules are evaluated against the freshly saved entry (deterministic,
 * local). evaluateAlerts NEVER throws and webhook failures are recorded as
 * failed notifications, so a broken webhook can never break the save.
 */
export async function POST(request: NextRequest) {
  return withApi(request, { route: "/api/history", scope: "write" }, async () => {
    const raw = (await request.json()) as Record<string, unknown>;
    const input = validateHistoryInput(raw);
    const entry = createHistoryEntry(input);
    await evaluateAlerts(entry);
    return new NextResponse(JSON.stringify({ ok: true, data: entry }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  });
}