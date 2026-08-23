import type { HistoryEntry, Incident, IncidentInput, HistoryInput } from "@/types";
import { ToolError } from "@/lib/errors";
import { getDb } from "./db";
import { BACKUP_SCHEMA_VERSION } from "./backup";
import {
  createIncident,
  listIncidents,
  validateIncidentInput,
} from "./incidents";
import {
  createHistoryEntry,
  listHistory,
  validateHistoryInput,
} from "./history";

/**
 * Export / import for incidents and support history (Phase 2).
 *
 * Exports are full snapshots as JSON (schema-versioned) or per-kind CSV.
 * Imports restore the data with duplicate protection:
 *   - history entries dedupe on (tool + created_at + payload) hash,
 *   - incidents dedupe on a content hash of all user-editable fields
 *     (ids are NOT used — they are not stable across machines).
 */

export interface BackupBundle {
  schemaVersion: number;
  exportedAt: string;
  incidents: Incident[];
  history: HistoryEntry[];
}

export interface ImportResult {
  importedIncidents: number;
  importedHistory: number;
  skipped: number;
}

export function exportAllData(): BackupBundle {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    incidents: listIncidents(),
    history: listHistory(),
  };
}

export function bundleToJson(bundle: BackupBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/** Stable non-cryptographic content hash (djb2) for duplicate detection. */
function contentHash(fields: string[]): string {
  let hash = 5381;
  for (const field of fields) {
    for (let i = 0; i < field.length; i++) {
      hash = ((hash << 5) + hash + field.charCodeAt(i)) >>> 0;
    }
    hash = ((hash << 5) + hash + 0x2c) >>> 0; // separator
  }
  return hash.toString(36);
}

function incidentContentHash(input: IncidentInput): string {
  return contentHash([
    input.title,
    input.system,
    input.environment,
    input.severity,
    input.detectedAt,
    input.symptoms,
    input.rootCause,
    input.immediateFix,
    input.permanentFix,
    input.status,
    input.notes,
  ]);
}

function historyContentHash(tool: string, createdAt: string, payload: string): string {
  return contentHash([tool, createdAt, payload]);
}

interface ExistingHashes {
  incidents: Set<string>;
  history: Set<string>;
}

function loadExistingHashes(): ExistingHashes {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT title, system, environment, severity, detected_at, symptoms,
              root_cause, immediate_fix, permanent_fix, status, notes
       FROM incidents`,
    )
    .all() as Array<Record<string, string>>;
  const incidents = new Set(
    rows.map((r) =>
      contentHash([
        r.title,
        r.system,
        r.environment,
        r.severity,
        r.detected_at,
        r.symptoms,
        r.root_cause,
        r.immediate_fix,
        r.permanent_fix,
        r.status,
        r.notes,
      ]),
    ),
  );
  const historyRows = db
    .prepare("SELECT tool, created_at, payload FROM history")
    .all() as Array<{ tool: string; created_at: string; payload: string }>;
  const history = new Set(
    historyRows.map((r) => historyContentHash(r.tool, r.created_at, r.payload)),
  );
  return { incidents, history };
}

/**
 * Import a backup JSON bundle. Entries already present (by dedupe hash) are
 * skipped; invalid entries abort the whole import (all-or-nothing).
 */
export function importBundleJson(json: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ToolError("Invalid backup JSON.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ToolError("Invalid backup format.");
  }
  const bundle = parsed as Partial<BackupBundle>;
  if (bundle.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new ToolError(
      `Unsupported backup schema version: ${String(bundle.schemaVersion)} (expected ${BACKUP_SCHEMA_VERSION}).`,
    );
  }
  if (!Array.isArray(bundle.incidents) || !Array.isArray(bundle.history)) {
    throw new ToolError("Invalid backup format (incidents/history missing).");
  }
  // Capture outside the transaction closure so type narrowing survives.
  const bundledIncidents = bundle.incidents;
  const bundledHistory = bundle.history;

  const db = getDb();
  return db.transaction(() => {
    const existing = loadExistingHashes();
    let importedIncidents = 0;
    let importedHistory = 0;
    let skipped = 0;

    for (const raw of bundledIncidents) {
      const input = validateIncidentInput(raw as Partial<IncidentInput>);
      const hash = incidentContentHash(input);
      if (existing.incidents.has(hash)) {
        skipped += 1;
        continue;
      }
      createIncident(input);
      existing.incidents.add(hash);
      importedIncidents += 1;
    }

    for (const raw of bundledHistory) {
      const entry = raw as Partial<HistoryEntry>;
      const input = validateHistoryInput(entry as Partial<HistoryInput>);
      const createdAt = typeof entry.createdAt === "string" ? entry.createdAt : "";
      const hash = historyContentHash(input.tool, createdAt, input.payload);
      if (existing.history.has(hash)) {
        skipped += 1;
        continue;
      }
      createHistoryEntry(input, { createdAt });
      existing.history.add(hash);
      importedHistory += 1;
    }

    return { importedIncidents, importedHistory, skipped };
  })();
}

// ---------------------------------------------------------------------------
// CSV export (flat, Excel-friendly: BOM prefix, CRLF rows, quoted fields).
// ---------------------------------------------------------------------------

function csvEscape(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function incidentsToCsv(incidents: Incident[]): string {
  const header = [
    "id", "title", "system", "environment", "severity", "detectedAt",
    "symptoms", "rootCause", "immediateFix", "permanentFix", "status",
    "notes", "createdAt", "updatedAt",
  ];
  const rows = incidents.map((i) =>
    [
      i.id, i.title, i.system, i.environment, i.severity, i.detectedAt,
      i.symptoms, i.rootCause, i.immediateFix, i.permanentFix, i.status,
      i.notes, i.createdAt, i.updatedAt,
    ]
      .map(csvEscape)
      .join(","),
  );
  return `\uFEFF${[header.map(csvEscape).join(","), ...rows].join("\r\n")}`;
}

export function historyToCsv(entries: HistoryEntry[]): string {
  const header = [
    "id", "createdAt", "tool", "system", "summary", "severity",
    "payload",
  ];
  const rows = entries.map((e) => {
    return [
      e.id, e.createdAt, e.tool, e.system, e.summary, e.severity ?? "",
      e.payload,
    ]
      .map(csvEscape)
      .join(",");
  });
  return `\uFEFF${[header.map(csvEscape).join(","), ...rows].join("\r\n")}`;
}