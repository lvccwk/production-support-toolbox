import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

/**
 * Daily auto-backup (Phase 2). Writes a full JSON snapshot of `incidents`
 * and `history` into `<data dir>/backups/backups-YYYY-MM-DD.json`, at most
 * once per day. Uses raw SQL directly so this module never imports the db
 * singleton — no circular dependency with the repositories.
 *
 * Disable with `PST_AUTO_BACKUP=off`; tests are skipped automatically
 * (NODE_ENV=test).
 */

export const BACKUP_SCHEMA_VERSION = 1;
const ENV_OFF = "off";

function backupDirFor(dbFile: string): string {
  return path.join(path.dirname(dbFile), "backups");
}

/**
 * Write today's backup when enabled and not already present.
 * Returns the written file path, or null when skipped.
 */
export function writeDailyBackupIfMissing(
  database: Database.Database,
  dbFile: string,
): string | null {
  if (process.env.NODE_ENV === "test") return null;
  if (process.env.PST_AUTO_BACKUP === ENV_OFF) return null;

  const dir = backupDirFor(dbFile);
  const today = new Date().toISOString().slice(0, 10);
  const target = path.join(dir, `backups-${today}.json`);
  if (fs.existsSync(target)) return null;

  const incidents = database.prepare("SELECT * FROM incidents").all();
  const history = database.prepare("SELECT * FROM history").all();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    target,
    JSON.stringify(
      {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        incidents,
        history,
      },
      null,
      2,
    ),
  );
  return target;
}