import { NextRequest } from "next/server";
import { deleteAlertRule, getAlertRule, updateAlertRule } from "@/lib/database/alerts";
import { validateAlertRuleInput } from "@/lib/database/alerts";
import { withApi } from "@/lib/api/route";
import { guardBodySize } from "@/lib/api/http";
import { ApiError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const ROOT = "/api/alerts/[id]";

/** GET /api/alerts/[id] */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withApi(request, { route: ROOT, scope: "read" }, async () => {
    const id = parseId((await context.params).id);
    if (id === null) throw new ApiError("Invalid alert rule id.", "VALIDATION_ERROR");
    const rule = getAlertRule(id);
    if (!rule) throw ApiError.notFound("Alert rule not found.");
    return { rule };
  });
}

/** PUT /api/alerts/[id] — update name / condition / channels / cooldown. */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withApi(request, { route: ROOT, scope: "write" }, async () => {
    const id = parseId((await context.params).id);
    if (id === null) throw new ApiError("Invalid alert rule id.", "VALIDATION_ERROR");
    const sizeError = guardBodySize(request);
    if (sizeError) throw sizeError;
    const raw = (await request.json()) as Record<string, unknown>;
    const existing = getAlertRule(id);
    if (!existing) throw ApiError.notFound("Alert rule not found.");
    const input = validateAlertRuleInput({ ...existing, ...raw });
    const rule = updateAlertRule(id, input);
    if (!rule) throw ApiError.notFound("Alert rule not found.");
    return { rule };
  });
}

/** DELETE /api/alerts/[id] — remove a rule (also clears its cooldown keys). */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withApi(request, { route: ROOT, scope: "admin" }, async () => {
    const id = parseId((await context.params).id);
    if (id === null) throw new ApiError("Invalid alert rule id.", "VALIDATION_ERROR");
    if (!deleteAlertRule(id)) throw ApiError.notFound("Alert rule not found.");
    return { deleted: true };
  });
}