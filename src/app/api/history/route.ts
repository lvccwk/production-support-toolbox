import { NextRequest, NextResponse } from "next/server";
import {
  createHistoryEntry,
  listHistory,
  validateHistoryInput,
} from "@/lib/database/history";
import { evaluateAlerts, processAlertJobs } from "@/lib/database/alerts";
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
 * local). evaluateAlerts NEVER throws and only enqueues webhook jobs — the
 * response never blocks on webhook delivery. Processing happens in the
 * background worker; here we just nudge it so delivery starts immediately
 * instead of waiting for the next interval tick.
 */
export async function POST(request: NextRequest) {
  return withApi(request, { route: "/api/history", scope: "write" }, async () => {
    const raw = (await request.json()) as Record<string, unknown>;
    const input = validateHistoryInput(raw);
    const entry = createHistoryEntry(input);
    await evaluateAlerts(entry);
    // Fire-and-forget: the save response must not wait for outbound network.
    void processAlertJobs().catch(() => undefined);
    return new NextResponse(JSON.stringify({ ok: true, data: entry }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  });
}