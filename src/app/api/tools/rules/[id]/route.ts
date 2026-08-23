import { NextRequest } from "next/server";
import {
  deleteCustomRule,
  getCustomRule,
  updateCustomRule,
} from "@/lib/database/customRules";
import { validateCustomRuleInput } from "@/lib/rules/custom";
import { assertPatternsPerformant } from "@/lib/rules/verify";
import { withApi } from "@/lib/api/route";
import { guardBodySize } from "@/lib/api/http";
import { ApiError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const ROOT = "/api/tools/rules/[id]";

/** GET /api/tools/rules/[id] */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withApi(request, { route: ROOT, scope: "read" }, async () => {
    const id = parseId((await context.params).id);
    if (id === null) throw new ApiError("Invalid rule id.", "VALIDATION_ERROR");
    const rule = getCustomRule(id);
    if (!rule) throw ApiError.notFound("Rule not found.");
    return { rule };
  });
}

/** PUT /api/tools/rules/[id] — update any field (validated + torture-tested). */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withApi(request, { route: ROOT, scope: "write" }, async () => {
    const id = parseId((await context.params).id);
    if (id === null) throw new ApiError("Invalid rule id.", "VALIDATION_ERROR");
    const sizeError = guardBodySize(request);
    if (sizeError) throw sizeError;
    const raw = (await request.json()) as Record<string, unknown>;

    // Merge against the stored rule so the FULL final pattern set is verified.
    const existing = getCustomRule(id);
    if (!existing) throw ApiError.notFound("Rule not found.");
    const input = validateCustomRuleInput({ ...existing, ...raw });
    await assertPatternsPerformant(input.patterns);

    const rule = updateCustomRule(id, input);
    if (!rule) throw ApiError.notFound("Rule not found.");
    return { rule };
  });
}

/** DELETE /api/tools/rules/[id] */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withApi(request, { route: ROOT, scope: "admin" }, async () => {
    const id = parseId((await context.params).id);
    if (id === null) throw new ApiError("Invalid rule id.", "VALIDATION_ERROR");
    if (!deleteCustomRule(id)) throw ApiError.notFound("Rule not found.");
    return { deleted: true };
  });
}