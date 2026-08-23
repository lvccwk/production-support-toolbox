import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { writeDailyBackupIfMissing } from "./backup";

/**
 * SQLite access layer (sections 14-15). A single local database file, no
 * server. The file location can be overridden with the PST_DATA_DIR env
 * variable (used by tests and advanced setups).
 */

export const DEFAULT_DB_FILE = path.join(process.cwd(), "data", "app.db");

let db: Database.Database | null = null;
let boundPath: string | null = null;

export function dbFilePath(): string {
  return process.env.PST_DATA_DIR ?? DEFAULT_DB_FILE;
}

/** Point the database at a specific file (tests use temp files). */
export function initDb(filePath: string): Database.Database {
  if (db && boundPath !== filePath) {
    db.close();
    db = null;
  }
  boundPath = filePath;
  return getDb();
}

export function getDb(): Database.Database {
  const filePath = boundPath ?? dbFilePath();
  if (db && boundPath === filePath) return db;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const instance = new Database(filePath);
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");
  migrate(instance);
  writeDailyBackupIfMissing(instance, filePath);
  db = instance;
  boundPath = filePath;
  return instance;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    boundPath = null;
  }
}

function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      system TEXT NOT NULL DEFAULT '',
      environment TEXT NOT NULL DEFAULT '',
      severity TEXT NOT NULL DEFAULT 'Medium',
      detected_at TEXT NOT NULL DEFAULT '',
      symptoms TEXT NOT NULL DEFAULT '',
      root_cause TEXT NOT NULL DEFAULT '',
      immediate_fix TEXT NOT NULL DEFAULT '',
      permanent_fix TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Investigating',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      tool TEXT NOT NULL,
      system TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      severity TEXT,
      payload TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_incidents_updated_at ON incidents (updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_history_created_at ON history (created_at DESC);
  `);
}