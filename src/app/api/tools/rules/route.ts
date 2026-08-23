import { NextRequest, NextResponse } from "next/server";
import {
  createCustomRule,
  listCustomRules,
} from "@/lib/database/customRules";
import { scopeMatches, validateCustomRuleInput } from "@/lib/rules/custom";
import { assertPatternsPerformant } from "@/lib/rules/verify";
import { withApi } from "@/lib/api/route";
import { guardBodySize } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/tools/rules — scoped custom rule registry for agents.
 *
 * GET: list rules (optional ?scope=global|systems|components and ?system= /
 *      ?component= to see which rules WOULD apply; ?export=json returns the
 *      full bundle for backup/transfer to another machine).
 * POST: register a rule — validated (regex compile + static ReDoS screening +
 *      time-bounded torture test + caps), stored locally.
 *      Body: { name, scope:{type,values}, patterns[], severity,
 *              rootCauses[], investigation[], suggestedFixes[], ... , active? }
 */
export async function GET(request: NextRequest) {
  return withApi(request, { route: "/api/tools/rules", scope: "read" }, async () => {
    const { searchParams } = request.nextUrl;
    const scopeFilter = searchParams.get("scope");
    const system = searchParams.get("system");
    const component = searchParams.get("component");

    if (searchParams.get("export") === "json") {
      return {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        rules: listCustomRules(false),
      };
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
    return { rules };
  });
}

/** POST /api/tools/rules */
export async function POST(request: NextRequest) {
  return withApi(request, { route: "/api/tools/rules", scope: "write" }, async () => {
    const sizeError = guardBodySize(request);
    if (sizeError) throw sizeError;
    const raw = (await request.json()) as Record<string, unknown>;
    const input = validateCustomRuleInput(raw);
    await assertPatternsPerformant(input.patterns);
    const rule = createCustomRule(input);
    return new NextResponse(JSON.stringify({ ok: true, data: { rule } }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  });
}