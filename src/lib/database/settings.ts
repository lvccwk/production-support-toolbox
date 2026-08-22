import { getDb } from "./db";

/**
 * Key/value settings store (Phase 3). Runtime toggles live here; secret
 * material and static config stay in environment variables on purpose.
 */

export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
         updated_at = excluded.updated_at`,
    )
    .run(key, value, new Date().toISOString());
}

export function allSettings(): Record<string, string> {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as Array<{
    key: string;
    value: string;
  }>;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Privacy toggle helpers (defaults: masking ON, audit OFF). */
export function isMaskingEnabled(): boolean {
  return getSetting("privacy:masking") !== "0";
}

export function isAuditEnabled(): boolean {
  return getSetting("privacy:audit") === "1";
}