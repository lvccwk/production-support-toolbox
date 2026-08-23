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

    -- AI fallback result cache (rule-engine misses; opt-in via PST_AI_FALLBACK).
    CREATE TABLE IF NOT EXISTS analysis_cache (
      cache_key  TEXT PRIMARY KEY,
      result     TEXT NOT NULL,
      model      TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    -- Scoped custom rules (Phase 6): user/agent-registered detections.
    CREATE TABLE IF NOT EXISTS custom_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      scope_type TEXT NOT NULL DEFAULT 'global',
      scope_values TEXT NOT NULL DEFAULT '[]',
      patterns TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'Medium',
      affected_components TEXT NOT NULL DEFAULT '[]',
      root_causes TEXT NOT NULL DEFAULT '[]',
      investigation TEXT NOT NULL DEFAULT '[]',
      suggested_fixes TEXT NOT NULL DEFAULT '[]',
      long_term_improvements TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_custom_rules_active ON custom_rules (active);

    -- Alert rules (user-configured triggers on saved analyses).
    CREATE TABLE IF NOT EXISTS alert_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      condition TEXT NOT NULL,
      channels TEXT NOT NULL DEFAULT '[]',
      cooldown_minutes INTEGER NOT NULL DEFAULT 60,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alert_rules_active ON alert_rules (active);

    -- Every firing, always recorded locally (webhook delivery optional).
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      rule_id INTEGER,
      rule_name TEXT NOT NULL DEFAULT '',
      level TEXT NOT NULL DEFAULT 'Informational',
      title TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      channel TEXT NOT NULL DEFAULT 'in-app',
      status TEXT NOT NULL DEFAULT 'sent',
      detail TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications (created_at DESC);

    -- Anti-spam: last firing per (rule, signal key) for cooldown purposes.
    CREATE TABLE IF NOT EXISTS alert_firings (
      rule_id INTEGER NOT NULL,
      fire_key TEXT NOT NULL,
      fired_at TEXT NOT NULL,
      PRIMARY KEY (rule_id, fire_key)
    );

    -- Async webhook delivery queue: Save Analysis only enqueues here and
    -- responds immediately; a background worker delivers with retry/backoff.
    CREATE TABLE IF NOT EXISTS alert_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notification_id INTEGER NOT NULL,
      rule_id INTEGER,
      rule_name TEXT NOT NULL DEFAULT '',
      webhook_url TEXT NOT NULL,
      payload TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'pending',
      next_attempt_at TEXT NOT NULL,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alert_jobs_due ON alert_jobs (status, next_attempt_at);
  `);

  // Legacy databases (pre-hybrid era) created analysis_cache with a different
  // schema (id/tool/...); IF NOT EXISTS keeps it, which breaks the fallback.
  // Detect the old shape and rebuild the table with the minimal schema.
  const cacheColumns = database.prepare("PRAGMA table_info(analysis_cache)").all() as Array<{
    name: string;
  }>;
  if (cacheColumns.some((c) => c.name === "tool")) {
    database.exec(
      `DROP TABLE analysis_cache;
       CREATE TABLE analysis_cache (
         cache_key  TEXT PRIMARY KEY,
         result     TEXT NOT NULL,
         model      TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL
       );`,
    );
  }
}