import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb, initDb } from "./db";
import { writeDailyBackupIfMissing } from "./backup";
import {
  bundleToJson,
  exportAllData,
  historyToCsv,
  importBundleJson,
  incidentsToCsv,
} from "./export";
import { listHistory } from "./history";
import { createHistoryEntry, validateHistoryInput } from "./history";
import { listIncidents } from "./incidents";
import { createIncident, validateIncidentInput } from "./incidents";
import type { Incident, IncidentInput } from "@/types";
import { ToolError } from "@/lib/errors";

let tempDir: string;
let currentDbFile: string;
let seq = 0;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pst-exp-"));
});

beforeEach(() => {
  seq += 1;
  currentDbFile = path.join(tempDir, `test-${seq}.db`);
  initDb(currentDbFile);
});

afterAll(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const INCIDENT_INPUT: IncidentInput = {
  title: "Payment batch NPE",
  system: "PaymentBatch",
  environment: "Production",
  severity: "High",
  detectedAt: "2026-08-21 10:15:22",
  symptoms: "Batch job failed with NPE",
  rootCause: "Null input record",
  immediateFix: "Skip bad record",
  permanentFix: "Validate before dereference",
  status: "Investigating",
  notes: "see history",
};

function seed() {
  createHistoryEntry(
    validateHistoryInput({
      tool: "log-analyzer",
      system: "PaymentBatch",
      summary: "NPE in batch",
      severity: "High",
      payload: JSON.stringify({ input: "demo log" }),
    }),
    { createdAt: "2026-08-21T10:00:00.000Z" },
  );
}

function incidentRow(id: number, title: string): Incident {
  return {
    id,
    title,
    system: "PaymentBatch",
    environment: "Production",
    severity: "Low",
    detectedAt: "",
    symptoms: "",
    rootCause: "",
    immediateFix: "",
    permanentFix: "",
    status: "Investigating",
    notes: "",
    createdAt: "2026-08-21T10:00:00.000Z",
    updatedAt: "2026-08-21T10:00:00.000Z",
  };
}

describe("export (Phase 2)", () => {
  it("exports a schema-versioned bundle containing both tables", () => {
    seed();
    const incident = createIncidentFrom(INCIDENT_INPUT);
    expect(incident.id).toBeGreaterThan(0);

    const bundle = exportAllData();
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.incidents).toHaveLength(1);
    expect(bundle.history).toHaveLength(1);

    const parsed = JSON.parse(bundleToJson(bundle)) as typeof bundle;
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.incidents[0]?.title).toBe(INCIDENT_INPUT.title);
  });

  it("round-trips: import restores rows and a second import skips all", () => {
    seed();
    createIncidentFrom(INCIDENT_INPUT);
    const json = bundleToJson(exportAllData());

    const first = importBundleJson(json);
    // Same DB: everything already exists -> all skipped.
    expect(first).toEqual({ importedIncidents: 0, importedHistory: 0, skipped: 2 });
    expect(listIncidents()).toHaveLength(1);
    expect(listHistory()).toHaveLength(1);

    // Fresh DB: importing into an empty database imports everything again.
    currentDbFile = path.join(tempDir, `fresh-${seq}.db`);
    initDb(currentDbFile);
    const restore = importBundleJson(json);
    expect(restore).toEqual({ importedIncidents: 1, importedHistory: 1, skipped: 0 });
    expect(listHistory()[0]?.createdAt).toBe("2026-08-21T10:00:00.000Z");

    // Into the same DB again: all duplicates.
    const second = importBundleJson(json);
    expect(second).toEqual({ importedIncidents: 0, importedHistory: 0, skipped: 2 });
    expect(listIncidents()).toHaveLength(1);
    expect(listHistory()).toHaveLength(1);
  });

  it("deduplicates by content, not by id (ids differ across machines)", () => {
    const bundle = (incidents: Incident[]) => ({
      schemaVersion: 1,
      exportedAt: "2026-08-21T10:00:00.000Z",
      incidents,
      history: [],
    });
    importBundleJson(JSON.stringify(bundle([incidentRow(1, "same title")])));
    const result = importBundleJson(
      JSON.stringify(bundle([incidentRow(999, "same title")])),
    );
    expect(result.importedIncidents).toBe(0);
    expect(result.skipped).toBe(1);
    expect(listIncidents()).toHaveLength(1);

    // Different content -> imported.
    const newOne = importBundleJson(
      JSON.stringify(bundle([incidentRow(2, "a different title")])),
    );
    expect(newOne.importedIncidents).toBe(1);
  });

  it("rejects invalid JSON, bad schema versions and malformed bundles", () => {
    expect(() => importBundleJson("{nope")).toThrowError(/Invalid backup JSON/);
    expect(() =>
      importBundleJson(
        JSON.stringify({ schemaVersion: 99, incidents: [], history: [] }),
      ),
    ).toThrowError(/Unsupported backup schema/);
    expect(() =>
      importBundleJson(JSON.stringify({ schemaVersion: 1 })),
    ).toThrowError(/incidents\/history missing/);
    expect(() =>
      importBundleJson(
        JSON.stringify({
          schemaVersion: 1,
          incidents: [{ title: "" }],
          history: [],
        }),
      ),
    ).toThrowError(ToolError);
  });
});

describe("CSV export", () => {
  it("emits BOM-prefixed, CRLF, quoted fields", () => {
    const csv = incidentsToCsv([incidentRow(7, 'a,b "quoted"')]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toContain('"id","title"');
    expect(lines[1]).toContain('"a,b ""quoted"""');
  });

  it("exports history with payload column intact", () => {
    seed();
    const csv = historyToCsv(exportAllData().history);
    expect(csv.startsWith('\uFEFF"id","createdAt","tool"')).toBe(true);
    expect(csv).toContain('"log-analyzer"');
    // JSON payload survives with quotes escaped (CSV doubling).
    expect(csv).toContain('{""input"":""demo log""}');
  });

  it("exports AI analysis as flat CSV columns", () => {
    const ai = {
      severity: "High" as const,
      errorTypes: ["NullPointerException"],
      rootCause: "null deref at line 2",
      rootCauseZh: "第 2 行發生空值解除引用",
      evidenceLines: [2],
      nextSteps: ["fix the null guard"],
      nextStepsZh: ["修正空值防護"],
      confidence: 0.82,
      explanation: "stack frame points to the dereference",
      explanationZh: "堆疊框架指向解除引用的位置",
    };
    createHistoryEntry(
      validateHistoryInput({
        tool: "log-analyzer",
        system: "PaymentBatch",
        summary: "AI analysis",
        severity: "High",
        payload: "{}",
        ai,
      }),
      { createdAt: "2026-08-21T10:00:00.000Z" },
    );
    const csv = historyToCsv(exportAllData().history);
    expect(csv).toContain('"ai_severity","ai_confidence","ai_error_types"');
    expect(csv).toContain('"High","0.82","[""NullPointerException""]"');
    expect(csv).toContain("第 2 行發生空值解除引用");
    expect(csv).toContain('"[""修正空值防護""]"');
    expect(csv).toContain('ai_root_cause_zh');
    expect(csv).toContain('"[2]"');
  });

  it("preserves AI analysis through a JSON export/import round-trip", () => {
    const ai = {
      severity: "Medium" as const,
      errorTypes: ["Timeout"],
      rootCause: "slow dependency",
      rootCauseZh: "依賴服務回應緩慢",
      evidenceLines: [1],
      nextSteps: ["add backoff"],
      nextStepsZh: ["加入退避重試"],
      confidence: 0.6,
      explanation: "read timeout observed",
      explanationZh: "觀察到讀取逾時",
    };
    createHistoryEntry(
      validateHistoryInput({
        tool: "log-analyzer",
        system: "",
        summary: "round trip",
        severity: "Medium",
        payload: "{}",
        ai,
      }),
      { createdAt: "2026-08-21T10:00:00.000Z" },
    );
    const json = bundleToJson(exportAllData());
    currentDbFile = path.join(tempDir, `ai-roundtrip-${seq}.db`);
    initDb(currentDbFile);
    importBundleJson(json);
    expect(listHistory()[0]?.ai).toEqual(ai);
  });

  it("ignores unvalidatable AI payloads instead of failing the save", () => {
    createHistoryEntry(
      validateHistoryInput({
        tool: "log-analyzer",
        system: "",
        summary: "bad ai",
        severity: "Low",
        payload: "{}",
        ai: { severity: "Urgent" } as never,
      }),
    );
    expect(listHistory()[0]?.ai).toBeNull();
  });
});

describe("daily auto-backup", () => {
  it("skips entirely under test environment", () => {
    expect(writeDailyBackupIfMissing(getDb(), currentDbFile)).toBeNull();
  });

  it("writes one backup per day when enabled", () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.PST_AUTO_BACKUP;
    try {
      const written = writeDailyBackupIfMissing(getDb(), currentDbFile);
      expect(written).not.toBeNull();
      expect(fs.existsSync(written as string)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(written as string, "utf8")) as {
        schemaVersion: number;
        incidents: unknown[];
        history: unknown[];
      };
      expect(parsed.schemaVersion).toBe(1);
      expect(Array.isArray(parsed.incidents)).toBe(true);
      expect(Array.isArray(parsed.history)).toBe(true);

      expect(writeDailyBackupIfMissing(getDb(), currentDbFile)).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("respects PST_AUTO_BACKUP=off", () => {
    const originalFlag = process.env.PST_AUTO_BACKUP;
    process.env.PST_AUTO_BACKUP = "off";
    try {
      // Use a fresh db file so the backup does not exist yet.
      const fresh = path.join(tempDir, "auto-off.db");
      initDb(fresh);
      expect(writeDailyBackupIfMissing(getDb(), fresh)).toBeNull();
    } finally {
      if (originalFlag === undefined) delete process.env.PST_AUTO_BACKUP;
      else process.env.PST_AUTO_BACKUP = originalFlag;
    }
  });
});

/** Create an incident from validated input and return the stored row. */
function createIncidentFrom(input: IncidentInput): Incident {
  return createIncident(validateIncidentInput(input));
}