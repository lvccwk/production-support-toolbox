import { torturePatterns } from "./torture";
import { ToolError } from "@/lib/errors";

/**
 * Empirical, time-bounded performance verification for rule patterns
 * (Engineering Review §4). Called by the API routes BEFORE a rule is stored
 * (registration, update, import) — a pattern that passes static screening but
 * still hangs on adversarial inputs is rejected here. The budget scales with
 * the number of patterns so legitimate bulk imports are not starved.
 */
export async function assertPatternsPerformant(
  patterns: readonly string[],
): Promise<void> {
  // Budget is measured from worker readiness (see torture.ts), so it covers
  // actual pattern execution only. Base covers one pattern; each extra gets
  // its own allowance so legitimate bulk imports are not starved.
  const budgetMs = 1200 + patterns.length * 40;
  const result = await torturePatterns(patterns, { budgetMs });
  if (!result.ok) {
    throw new ToolError(
      result.error ?? "Pattern rejected by the execution-time safety check.",
    );
  }
}