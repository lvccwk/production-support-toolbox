import { listHistory } from "@/lib/database/history";
import type { Severity } from "@/types";

/**
 * Incident Dossier: auto-recall of past incidents for the same system from
 * the LOCAL Support History, so analysis and agents have real ground truth
 * ("this system broke like this before") instead of guessing from one log.
 *
 * Privacy: only summary / severity are included — never the raw `payload`
 * (which may contain pasted logs).
 */

export interface DossierEntry {
  id: number;
  createdAt: string;
  tool: string;
  summary: string;
  severity: Severity | null;
}

/** Disable with PST_DOSSIER=off. */
export function dossierEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PST_DOSSIER !== "off";
}

/** Latest incidents whose `system` matches (case-insensitive LIKE), capped. */
export function loadIncidentDossier(
  system?: string,
  limit = 3,
  env: NodeJS.ProcessEnv = process.env,
): DossierEntry[] {
  const trimmed = system?.trim();
  if (!trimmed || !dossierEnabled(env)) return [];
  const rows = listHistory(trimmed);
  const matches = rows.filter((row) =>
    row.system.toLowerCase().includes(trimmed.toLowerCase()),
  ).slice(0, limit);
  if (matches.length === 0) return [];

  return matches.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    tool: row.tool,
    summary: row.summary,
    severity: row.severity,
  }));
}

/** Stable signature of the recalled entries (for cache keys). */
export function dossierSignature(entries: DossierEntry[]): string {
  return entries.map((e) => `${e.id}`).join(",");
}