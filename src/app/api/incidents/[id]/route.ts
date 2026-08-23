import { NextRequest } from "next/server";
import {
  deleteIncident,
  getIncident,
  updateIncident,
  validateIncidentInput,
} from "@/lib/database/incidents";
import { withApi } from "@/lib/api/route";
import { ApiError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const ROOT = "/api/incidents/[id]";

/** GET /api/incidents/[id] */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withApi(request, { route: ROOT, scope: "read" }, async () => {
    const id = parseId((await context.params).id);
    if (id === null) throw new ApiError("Invalid id.", "VALIDATION_ERROR");
    const incident = getIncident(id);
    if (!incident) throw ApiError.notFound("Incident not found.");
    return incident;
  });
}

/** PUT /api/incidents/[id] */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withApi(request, { route: ROOT, scope: "write" }, async () => {
    const id = parseId((await context.params).id);
    if (id === null) throw new ApiError("Invalid id.", "VALIDATION_ERROR");
    const raw = (await request.json()) as Record<string, unknown>;
    const input = validateIncidentInput(raw);
    const incident = updateIncident(id, input);
    if (!incident) throw ApiError.notFound("Incident not found.");
    return incident;
  });
}

/** DELETE /api/incidents/[id] */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withApi(request, { route: ROOT, scope: "admin" }, async () => {
    const id = parseId((await context.params).id);
    if (id === null) throw new ApiError("Invalid id.", "VALIDATION_ERROR");
    if (!deleteIncident(id)) throw ApiError.notFound("Incident not found.");
    return { deleted: true };
  });
}