import { NextRequest, NextResponse } from "next/server";
import {
  createIncident,
  listIncidents,
  validateIncidentInput,
} from "@/lib/database/incidents";
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

/** GET /api/incidents?q=... — list incidents (optional search). */
export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("q") ?? undefined;
    return NextResponse.json({ ok: true, data: listIncidents(query) });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

/** POST /api/incidents — create an incident. */
export async function POST(request: NextRequest) {
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    const input = validateIncidentInput(raw);
    const incident = createIncident(input);
    return NextResponse.json({ ok: true, data: incident }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}