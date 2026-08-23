import { NextRequest, NextResponse } from "next/server";
import {
  createCustomRule,
  listCustomRules,
} from "@/lib/database/customRules";
import { scopeMatches } from "@/lib/rules/custom";
import { toolErrorResponse, toolOk } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/tools/rules — scoped custom rule registry for agents.
 *
 * GET: list rules (optional ?scope=global|systems|components and ?system= /
 *      ?component= to see which rules WOULD apply; ?export=json returns the
 *      full bundle for backup/transfer to another machine).
 * POST: register a rule — validated (regex compile + caps), stored locally.
 *       Body: { name, scope:{type,values}, patterns[], severity,
 *               rootCauses[], investigation[], suggestedFixes[], ... , active? }
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const scopeFilter = searchParams.get("scope");
  const system = searchParams.get("system");
  const component = searchParams.get("component");

  if (searchParams.get("export") === "json") {
    return toolOk({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      rules: listCustomRules(false),
    });
  }

  let rules = listCustomRules(false);
  if (scopeFilter) {
    rules = rules.filter((r) => r.scope.type === scopeFilter);
  }
  if (system || component) {
    const ctx = {
      system: system ?? undefined,
      components: component ? [component] : [],
    };
    rules = rules.filter((r) => scopeMatches(r.scope, ctx));
  }
  return toolOk({ rules });
}

/** POST /api/tools/rules */
export async function POST(request: NextRequest) {
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    const rule = createCustomRule(raw);
    return NextResponse.json({ ok: true, data: { rule } }, { status: 201 });
  } catch (error) {
    return toolErrorResponse(error);
  }
}