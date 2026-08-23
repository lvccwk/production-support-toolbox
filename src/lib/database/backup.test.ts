import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb, initDb } from "./db";
import { writeDailyBackupIfMissing, backupRetentionDays } from "./backup";
import { exportAllData, importBundleJson } from "./export";
import { createCustomRule, listCustomRules } from "./customRules";
import { createHistoryEntry, validateHistoryInput } from "./history";
import { createIncident, validateIncidentInput } from "./incidents";
import type { CustomRuleInput } from "@/types";

let tempDir: string;
let currentDbFile: string;
let seq = 0;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pst-bak-"));
});

beforeEach(() => {
  seq += 1;
  // Each test gets its OWN data directory so the daily-backup folder (and the
  // today-dated file inside it) can never collide between tests.
  const dir = path.join(tempDir, `db-${seq}`);
  fs.mkdirSync(dir, { recursive: true });
  currentDbFile = path.join(dir, "app.db");
  initDb(currentDbFile);
});

afterAll(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const RULE: CustomRuleInput = {
  name: "pay-step44-timeout",
  scope: { type: "components", values: ["PaymentBatch"] },
  patterns: ["STEP44.*timeout"],
  severity: "High",
  rootCauses: ["PAY gateway timeout"],
};

function seed() {
  createIncident(
    validateIncidentInput({
      title: "Payment batch NPE",
      system: "PaymentBatch",
      environment: "Production",
      severity: "High",
      detectedAt: "2026-08-21 10:15:22",
      symptoms: "Batch failed",
      rootCause: "Null input",
      immediateFix: "Restart",
      permanentFix: "Validate",
      status: "Investigating",
      notes: "x",
    }),
  );
  createHistoryEntry(
    validateHistoryInput({
      tool: "log-analyzer",
      system: "PaymentBatch",
      summary: "NPE",
      severity: "High",
      payload: JSON.stringify({ input: "demo" }),
    }),
    { createdAt: "2026-08-21T10:00:00.000Z" },
  );
  createCustomRule(RULE);
}

function ruleKeys(rules: Array<{ name: string; scope: { type: string; values: string[] }; patterns: string[] }>) {
  return rules
    .map((r) => `${r.scope.type}|${r.scope.values.join(",")}|${r.name}|${r.patterns.join(";")}`)
    .sort();
}

function incidentKeys(incidents: Array<{ title: string; system: string; severity: string }>) {
  return incidents.map((i) => `${i.title}|${i.system}|${i.severity}`).sort();
}

function historyKeys(entries: Array<{ tool: string; summary: string; payload: string }>) {
  return entries.map((e) => `${e.tool}|${e.summary}|${e.payload}`).sort();
}

describe("daily auto-backup (schema v2, Engineering Review §6)", () => {
  it("writes incidents + history + customRules with schemaVersion 2", () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.PST_AUTO_BACKUP;
    try {
      seed();
      const written = writeDailyBackupIfMissing(getDb(), currentDbFile);
      expect(written).not.toBeNull();
      const parsed = JSON.parse(fs.readFileSync(written as string, "utf8")) as {
        schemaVersion: number;
        exportedAt: string;
        incidents: unknown[];
        history: unknown[];
        customRules: unknown[];
      };
      expect(parsed.schemaVersion).toBe(2);
      expect(parsed.exportedAt).toBeTruthy();
      expect(parsed.incidents).toHaveLength(1);
      expect(parsed.history).toHaveLength(1);
      expect(parsed.customRules).toHaveLength(1);
      expect(parsed.customRules[0]).toMatchObject({ name: "pay-step44-timeout" });

      // A second call the same day does not rewrite (never clobbers valid backup).
      expect(writeDailyBackupIfMissing(getDb(), currentDbFile)).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("never leaves a partially written file behind (target only appears whole)", () => {
    vi.stubEnv("NODE_ENV", "development");
    try {
      seed();
      const today = new Date().toISOString().slice(0, 10);
      const target = path.join(
        path.dirname(currentDbFile),
        "backups",
        `backups-${today}.json`,
      );
      // Simulate an interrupted write: a stray temp file exists, target does not.
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(`${target}.999.abcdef.tmp`, "{not-json");
      const written = writeDailyBackupIfMissing(getDb(), currentDbFile);
      expect(written).toBe(target);
      const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
      expect(parsed.schemaVersion).toBe(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("prunes old backups to the retention limit", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PST_BACKUP_RETENTION", "2");
    try {
      const dir = path.join(path.dirname(currentDbFile), "backups");
      fs.mkdirSync(dir, { recursive: true });
      for (const day of ["2026-08-01", "2026-08-02", "2026-08-03"]) {
        fs.writeFileSync(path.join(dir, `backups-${day}.json`), "{}");
      }
      seed();
      const written = writeDailyBackupIfMissing(getDb(), currentDbFile);
      expect(written).not.toBeNull();
      const remaining = fs
        .readdirSync(dir)
        .filter((name) => /^backups-\d{4}-\d{2}-\d{2}\.json$/.test(name));
      // Retention 2 -> the two newest survive (today + 08-03).
      expect(remaining.length).toBe(2);
      expect(remaining).not.toContain("backups-2026-08-01.json");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("backupRetentionDays defaults to 30 and honours the env", () => {
    expect(backupRetentionDays({} as unknown as NodeJS.ProcessEnv)).toBe(30);
    expect(
      backupRetentionDays({ PST_BACKUP_RETENTION: "7" } as unknown as NodeJS.ProcessEnv),
    ).toBe(7);
  });
});

describe("restore drill (§6): export -> clean DB -> import -> deep comparison", () => {
  it("restores incidents, history AND custom rules into a fresh database", () => {
    seed();
    const exported = exportAllData();
    const json = JSON.stringify(exported);

    const freshFile = path.join(tempDir, `restore-${seq}.db`);
    initDb(freshFile);
    const result = importBundleJson(json);
    expect(result.importedIncidents).toBe(1);
    expect(result.importedHistory).toBe(1);
    expect(result.importedRules).toBe(1);

    const check = exportAllData();
    expect(incidentKeys(check.incidents)).toEqual(incidentKeys(exported.incidents));
    expect(historyKeys(check.history)).toEqual(historyKeys(exported.history));
    expect(ruleKeys(check.customRules)).toEqual(ruleKeys(exported.customRules));

    // Second restore is a full no-op (all duplicates — rules counted separately).
    const again = importBundleJson(json);
    expect(again).toEqual({
      importedIncidents: 0,
      importedHistory: 0,
      importedRules: 0,
      skipped: 2,
      skippedRules: 1,
    });
  });

  it("still imports legacy schema-v1 backups (no customRules field)", () => {
    const v1 = JSON.stringify({
      schemaVersion: 1,
      exportedAt: "2026-08-01T00:00:00.000Z",
      incidents: [
        {
          id: 1,
          title: "legacy",
          system: "",
          environment: "",
          severity: "Low",
          detectedAt: "",
          symptoms: "",
          rootCause: "",
          immediateFix: "",
          permanentFix: "",
          status: "Closed",
          notes: "",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
      history: [],
    });
    const result = importBundleJson(v1);
    expect(result.importedIncidents).toBe(1);
    expect(result.importedRules).toBe(0);
    expect(listCustomRules(false)).toHaveLength(0);
  });

  it("restores from the actual daily-backup FILE (not just exportAllData)", () => {
    vi.stubEnv("NODE_ENV", "development");
    try {
      seed();
      const file = writeDailyBackupIfMissing(getDb(), currentDbFile);
      expect(file).not.toBeNull();
      const freshFile = path.join(tempDir, `file-restore-${seq}.db`);
      initDb(freshFile);
      const json = fs.readFileSync(file as string, "utf8");
      const result = importBundleJson(json);
      expect(result.importedRules).toBe(1);
      expect(listCustomRules(false).map((r) => r.name)).toEqual(["pay-step44-timeout"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("canonical serializer — no drift between daily backup and manual export (§6)", () => {
  it("produces identical incidents/history/customRules (export only ADDs analysis)", () => {
    vi.stubEnv("NODE_ENV", "development");
    try {
      seed();
      const file = writeDailyBackupIfMissing(getDb(), currentDbFile);
      expect(file).not.toBeNull();
      const backup = JSON.parse(fs.readFileSync(file as string, "utf8")) as {
        schemaVersion: number;
        exportedAt: string;
        incidents: unknown[];
        history: Array<Record<string, unknown>>;
        customRules: unknown[];
      };
      const exported = exportAllData();
      expect(backup.schemaVersion).toBe(exported.schemaVersion);
      expect(backup.incidents).toEqual(exported.incidents);

      // Export preserves every history field and only ADDS `analysis`.
      const plainHistory = exported.history.map((entry) => ({
        id: entry.id,
        createdAt: entry.createdAt,
        tool: entry.tool,
        system: entry.system,
        summary: entry.summary,
        severity: entry.severity,
        payload: entry.payload,
      }));
      expect(backup.history).toEqual(plainHistory);
      expect(backup.customRules).toEqual(exported.customRules);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});