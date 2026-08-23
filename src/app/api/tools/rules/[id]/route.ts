import { NextRequest } from "next/server";
import {
  deleteCustomRule,
  getCustomRule,
  updateCustomRule,
} from "@/lib/database/customRules";
import { ToolError } from "@/lib/errors";
import { toolErrorResponse, toolOk } from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** GET /api/tools/rules/[id] */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await context.params).id);
    if (id === null) throw new ToolError("Invalid rule id.");
    const rule = getCustomRule(id);
    if (!rule) throw new ToolError("Rule not found.");
    return toolOk({ rule });
  } catch (error) {
    return toolErrorResponse(error, error instanceof ToolError ? 404 : 400);
  }
}

/** PUT /api/tools/rules/[id] — update any field (validated). */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await context.params).id);
    if (id === null) throw new ToolError("Invalid rule id.");
    const raw = (await request.json()) as Record<string, unknown>;
    const rule = updateCustomRule(id, raw);
    if (!rule) throw new ToolError("Rule not found.");
    return toolOk({ rule });
  } catch (error) {
    return toolErrorResponse(error, error instanceof ToolError ? 404 : 400);
  }
}

/** DELETE /api/tools/rules/[id] */
export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await context.params).id);
    if (id === null) throw new ToolError("Invalid rule id.");
    if (!deleteCustomRule(id)) throw new ToolError("Rule not found.");
    return toolOk({ deleted: true });
  } catch (error) {
    return toolErrorResponse(error, error instanceof ToolError ? 404 : 400);
  }
}