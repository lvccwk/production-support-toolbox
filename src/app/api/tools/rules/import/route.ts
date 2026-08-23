import { NextRequest } from "next/server";
import { createCustomRule, listCustomRules } from "@/lib/database/customRules";
import { ruleSignature, validateCustomRuleInput } from "@/lib/rules/custom";
import { ToolError } from "@/lib/errors";
import { toolErrorResponse, toolOk } from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tools/rules/import — bulk-import rules from another machine
 * (from `GET /api/tools/rules?export=json`).
 *
 * Duplicates (same scope + name + patterns) are skipped; invalid entries
 * abort the whole import (all-or-nothing). Respects the active-rule cap.
 * Body: { "rules": [...] } or the raw export bundle { schemaVersion, rules }.
 */
export async function POST(request: NextRequest) {
  try {
    const raw = (await request.json()) as {
      rules?: unknown;
      schemaVersion?: unknown;
    };
    const candidates = Array.isArray(raw.rules) ? raw.rules : [];
    if (candidates.length === 0) {
      throw new ToolError("Please provide a rules array to import.");
    }

    // Validate every entry BEFORE touching the DB (all-or-nothing).
    const inputs = candidates.map((entry) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new ToolError("Invalid rule entry in import bundle.");
      }
      return validateCustomRuleInput(entry as Record<string, unknown>);
    });

    const existing = new Set(
      listCustomRules(false).map((rule) => ruleSignature(rule)),
    );
    let imported = 0;
    let skipped = 0;
    for (const input of inputs) {
      const signature = ruleSignature({
        name: input.name,
        scope: input.scope,
        patterns: input.patterns,
      });
      if (existing.has(signature)) {
        skipped += 1;
        continue;
      }
      createCustomRule(input);
      existing.add(signature);
      imported += 1;
    }
    return toolOk({ imported, skipped, total: inputs.length });
  } catch (error) {
    return toolErrorResponse(error);
  }
}