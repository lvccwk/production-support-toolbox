import { NextRequest } from "next/server";
import { bulkImportCustomRules } from "@/lib/database/customRules";
import { validateCustomRuleInput } from "@/lib/rules/custom";
import { assertPatternsPerformant } from "@/lib/rules/verify";
import { withApi } from "@/lib/api/route";
import { timedMetricAsync } from "@/lib/api/metrics";
import { ToolError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Max entries per import bundle (each ≤20 patterns, ≤300 chars — see custom.ts). */
export const MAX_RULES_PER_IMPORT = 500;

/**
 * POST /api/tools/rules/import — bulk-import rules from another machine
 * (from `GET /api/tools/rules?export=json`).
 *
 * Duplicates (same scope + name + patterns) are skipped; invalid entries
 * abort the whole import. The import itself is ATOMIC: validation, duplicate
 * calculation, capacity check and every insert run inside ONE transaction —
 * exceed the active cap (or fail at any point) and NOTHING is written.
 * Every pattern is also statically screened + time-bounded torture-tested
 * before the transaction starts. High-privilege (admin scope).
 * Body: { "rules": [...] } or the raw export bundle { schemaVersion, rules }.
 */
export async function POST(request: NextRequest) {
  return withApi(
    request,
    { route: "/api/tools/rules/import", scope: "admin" },
    async () => {
      const raw = (await request.json()) as {
        rules?: unknown;
        schemaVersion?: unknown;
      };
      const candidates = Array.isArray(raw.rules) ? raw.rules : [];
      if (candidates.length === 0) {
        throw new ToolError("Please provide a rules array to import.");
      }
      if (candidates.length > MAX_RULES_PER_IMPORT) {
        throw new ToolError(`Import bundle too large (max ${MAX_RULES_PER_IMPORT} rules).`);
      }

      // Validate every entry and torture-test ALL patterns BEFORE the DB
      // transaction (all-or-nothing guarantees nothing is written on failure).
      const inputs = candidates.map((entry) => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
          throw new ToolError("Invalid rule entry in import bundle.");
        }
        return validateCustomRuleInput(entry as Record<string, unknown>);
      });
      await assertPatternsPerformant(inputs.flatMap((input) => input.patterns));

      const { result } = await timedMetricAsync("rules_import", async () =>
        bulkImportCustomRules(inputs),
      );
      return { imported: result.imported, skipped: result.skipped, total: inputs.length };
    },
  );
}