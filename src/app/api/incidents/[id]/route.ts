import { NextRequest, NextResponse } from "next/server";
import {
  deleteIncident,
  getIncident,
  updateIncident,
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

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** GET /api/incidents/[id] */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (id === null) return errorResponse(new ToolError("Invalid id."), 400);
    const incident = getIncident(id);
    if (!incident) return errorResponse(new ToolError("Incident not found."), 404);
    return NextResponse.json({ ok: true, data: incident });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

/** PUT /api/incidents/[id] */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (id === null) return errorResponse(new ToolError("Invalid id."), 400);
    const raw = (await request.json()) as Record<string, unknown>;
    const input = validateIncidentInput(raw);
    const incident = updateIncident(id, input);
    if (!incident) return errorResponse(new ToolError("Incident not found."), 404);
    return NextResponse.json({ ok: true, data: incident });
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/incidents/[id] */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (id === null) return errorResponse(new ToolError("Invalid id."), 400);
    const deleted = deleteIncident(id);
    if (!deleted) return errorResponse(new ToolError("Incident not found."), 404);
    return NextResponse.json({ ok: true, data: { deleted: true } });
  } catch (error) {
    return errorResponse(error, 500);
  }
}