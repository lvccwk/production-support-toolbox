import { NextRequest, NextResponse } from "next/server";
import {
  createIncident,
  listIncidents,
  validateIncidentInput,
} from "@/lib/database/incidents";
import { withApi } from "@/lib/api/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/incidents?q=... — list incidents (optional search). */
export async function GET(request: NextRequest) {
  return withApi(request, { route: "/api/incidents", scope: "read" }, async () => {
    const query = request.nextUrl.searchParams.get("q") ?? undefined;
    return listIncidents(query);
  });
}

/** POST /api/incidents — create an incident. */
export async function POST(request: NextRequest) {
  return withApi(request, { route: "/api/incidents", scope: "write" }, async () => {
    const raw = (await request.json()) as Record<string, unknown>;
    const input = validateIncidentInput(raw);
    const incident = createIncident(input);
    return new NextResponse(JSON.stringify({ ok: true, data: incident }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  });
}