import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { readSnapshotRows } from "./snapshot";

/**
 * Daily auto-backup (Engineering Review §6).
 *
 * Writes a full JSON snapshot of `incidents`, `history` AND `customRules`
 * into `<data dir>/backups/backups-YYYY-MM-DD.json`, at most once per day.
 * The write is ATOMIC (temp file in the same directory -> flush -> rename),
 * so an interrupted write can never overwrite the last valid backup with a
 * half-written file. Old backups are pruned by retention (default: keep the
 * newest 30 days — override with PST_BACKUP_RETENTION).
 *
 * Rows are serialized through the canonical mappers (snapshot.ts) so the
 * daily backup and the manual JSON export can never drift apart.
 *
 * Disable with `PST_AUTO_BACKUP=off`; tests are skipped automatically
 * (NODE_ENV=test).
 */

export const BACKUP_SCHEMA_VERSION = 2;
const ENV_OFF = "off";
const DEFAULT_RETENTION = 30;

function backupDirFor(dbFile: string): string {
  return path.join(path.dirname(dbFile), "backups");
}

/** Retention in days for `backups-*.json` files (env-overridable). */
export function backupRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const fromEnv = Number(env.PST_BACKUP_RETENTION);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_RETENTION;
}

/** Atomically replace `target` with `content` (temp file + rename). */
function writeFileAtomic(target: string, content: string): void {
  const tmp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`,
  );
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, content, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
}

/** Delete expired backup files (oldest first, keep the newest `retention`). */
function pruneOldBackups(dir: string, retention: number): void {
  const files = fs
    .readdirSync(dir)
    .filter((name) => /^backups-\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort();
  const excess = files.length - retention;
  for (let i = 0; i < excess; i += 1) {
    try {
      fs.unlinkSync(path.join(dir, files[i]));
    } catch {
      // A concurrent cleanup may already have removed it — ignore.
    }
  }
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

  const { incidents, history, customRules } = readSnapshotRows(database);
  const payload = JSON.stringify(
    {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      incidents,
      history,
      customRules,
    },
    null,
    2,
  );

  fs.mkdirSync(dir, { recursive: true });
  writeFileAtomic(target, payload);
  pruneOldBackups(dir, backupRetentionDays());
  return target;
}