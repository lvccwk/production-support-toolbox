import { createHash } from "node:crypto";
import { getDb } from "@/lib/database/db";

/**
 * Server-side cache for LLM analyses (Phase 3). The cache key is a SHA-256
 * over (tool, normalised input, model, prompt version) so identical requests
 * cost nothing on repeat; any of those changing yields a fresh analysis.
 */

const PROMPT_VERSION = 2; // bumped when the prompt/schema contract changes

export function analysisCacheKey(input: {
  tool: string;
  input: string;
  model: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({ ...input, promptVersion: PROMPT_VERSION }))
    .digest("hex");
}

/** Returns the cached result JSON-parsed, or null on miss / parse failure. */
export function getCachedAnalysis(cacheKey: string): unknown | null {
  const row = getDb()
    .prepare("SELECT result FROM analysis_cache WHERE cache_key = ?")
    .get(cacheKey) as { result: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.result) as unknown;
  } catch {
    return null;
  }
}

/** Store (or refresh) a cached analysis result. */
export function putCachedAnalysis(
  cacheKey: string,
  tool: string,
  model: string,
  result: unknown,
): void {
  getDb()
    .prepare(
      `INSERT INTO analysis_cache (cache_key, tool, model, result, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         result = excluded.result,
         model = excluded.model,
         created_at = excluded.created_at`,
    )
    .run(cacheKey, tool, model, JSON.stringify(result), new Date().toISOString());
}