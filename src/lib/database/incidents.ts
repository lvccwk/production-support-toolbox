import type { Incident, IncidentInput, IncidentStatus, Severity } from "@/types";
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES } from "@/types";
import { ToolError } from "@/lib/errors";
import { getDb } from "./db";

/**
 * Incident notes repository (section 14). CRUD + search over SQLite.
 */

export interface IncidentRow {
  id: number;
  title: string;
  system: string;
  environment: string;
  severity: Severity;
  detected_at: string;
  symptoms: string;
  root_cause: string;
  immediate_fix: string;
  permanent_fix: string;
  status: IncidentStatus;
  notes: string;
  created_at: string;
  updated_at: string;
}

function toIncident(row: IncidentRow): Incident {
  return {
    id: row.id,
    title: row.title,
    system: row.system,
    environment: row.environment,
    severity: row.severity,
    detectedAt: row.detected_at,
    symptoms: row.symptoms,
    rootCause: row.root_cause,
    immediateFix: row.immediate_fix,
    permanentFix: row.permanent_fix,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const MAX_FIELD = 10_000;

/** Validate and normalise user input for creating/updating an incident. */
export function validateIncidentInput(raw: Partial<IncidentInput>): IncidentInput {
  const str = (value: unknown, field: string, max: number, required = false): string => {
    if (value === undefined || value === null) value = "";
    if (typeof value !== "string") throw new ToolError(`Invalid ${field}.`);
    const trimmed = value.trim();
    if (required && trimmed.length === 0) throw new ToolError(`${field} is required.`);
    if (trimmed.length > max) throw new ToolError(`${field} is too long (max ${max} chars).`);
    return trimmed;
  };

  const title = str(raw.title, "title", 200, true);
  const system = str(raw.system, "system", 100);
  const environment = str(raw.environment, "environment", 100);
  const severity = str(raw.severity, "severity", 20) as Severity;
  const status = str(raw.status, "status", 20) as IncidentStatus;

  if (!INCIDENT_SEVERITIES.includes(severity)) {
    throw new ToolError("Invalid severity.");
  }
  if (!INCIDENT_STATUSES.includes(status)) {
    throw new ToolError("Invalid status.");
  }

  return {
    title,
    system,
    environment,
    severity,
    detectedAt: str(raw.detectedAt, "detectedAt", 64),
    symptoms: str(raw.symptoms, "symptoms", MAX_FIELD),
    rootCause: str(raw.rootCause, "rootCause", MAX_FIELD),
    immediateFix: str(raw.immediateFix, "immediateFix", MAX_FIELD),
    permanentFix: str(raw.permanentFix, "permanentFix", MAX_FIELD),
    status,
    notes: str(raw.notes, "notes", MAX_FIELD),
  };
}

export function listIncidents(query?: string): Incident[] {
  const db = getDb();
  if (query && query.trim()) {
    const like = `%${query.trim()}%`;
    const rows = db
      .prepare(
        `SELECT * FROM incidents
         WHERE title LIKE ? OR system LIKE ? OR environment LIKE ? OR symptoms LIKE ? OR notes LIKE ?
         ORDER BY updated_at DESC`,
      )
      .all(like, like, like, like, like) as IncidentRow[];
    return rows.map(toIncident);
  }
  const rows = db
    .prepare("SELECT * FROM incidents ORDER BY updated_at DESC, id DESC")
    .all() as IncidentRow[];
  return rows.map(toIncident);
}

export function getIncident(id: number): Incident | null {
  const row = getDb().prepare("SELECT * FROM incidents WHERE id = ?").get(id) as
    | IncidentRow
    | undefined;
  return row ? toIncident(row) : null;
}

export function createIncident(input: IncidentInput): Incident {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO incidents
       (title, system, environment, severity, detected_at, symptoms, root_cause,
        immediate_fix, permanent_fix, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
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
      now,
      now,
    );
  return getIncident(Number(result.lastInsertRowid))!;
}

export function updateIncident(id: number, input: IncidentInput): Incident | null {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE incidents SET
         title = ?, system = ?, environment = ?, severity = ?, detected_at = ?,
         symptoms = ?, root_cause = ?, immediate_fix = ?, permanent_fix = ?,
         status = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
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
      new Date().toISOString(),
      id,
    );
  return result.changes > 0 ? getIncident(id) : null;
}

export function deleteIncident(id: number): boolean {
  const result = getDb().prepare("DELETE FROM incidents WHERE id = ?").run(id);
  return result.changes > 0;
}