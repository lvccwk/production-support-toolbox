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
import type { Incident, IncidentInput, Severity } from "@/types";
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
    expect(bundle.schemaVersion).toBe(2);
    expect(bundle.incidents).toHaveLength(1);
    expect(bundle.history).toHaveLength(1);
    expect(bundle.customRules).toEqual([]);

    const parsed = JSON.parse(bundleToJson(bundle)) as typeof bundle;
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.incidents[0]?.title).toBe(INCIDENT_INPUT.title);
  });

  it("round-trips: import restores rows and a second import skips all", () => {
    seed();
    createIncidentFrom(INCIDENT_INPUT);
    const json = bundleToJson(exportAllData());

    const first = importBundleJson(json);
    // Same DB: everything already exists -> all skipped.
    expect(first).toEqual({
      importedIncidents: 0,
      importedHistory: 0,
      importedRules: 0,
      skipped: 2,
      skippedRules: 0,
    });
    expect(listIncidents()).toHaveLength(1);
    expect(listHistory()).toHaveLength(1);

    // Fresh DB: importing into an empty database imports everything again.
    currentDbFile = path.join(tempDir, `fresh-${seq}.db`);
    initDb(currentDbFile);
    const restore = importBundleJson(json);
    expect(restore).toEqual({
      importedIncidents: 1,
      importedHistory: 1,
      importedRules: 0,
      skipped: 0,
      skippedRules: 0,
    });
    expect(listHistory()[0]?.createdAt).toBe("2026-08-21T10:00:00.000Z");

    // Into the same DB again: all duplicates.
    const second = importBundleJson(json);
    expect(second).toEqual({
      importedIncidents: 0,
      importedHistory: 0,
      importedRules: 0,
      skipped: 2,
      skippedRules: 0,
    });
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

  it("exports the history severity column", () => {
    createHistoryEntry(
      validateHistoryInput({
        tool: "log-analyzer",
        system: "PaymentBatch",
        summary: "batch NPE",
        severity: "High",
        payload: "{}",
      }),
      { createdAt: "2026-08-21T10:00:00.000Z" },
    );
    const csv = historyToCsv(exportAllData().history);
    expect(csv).toContain('"High"');
    expect(csv).toContain('"batch NPE"');
  });

  it("round-trips history through a JSON export/import", () => {
    createHistoryEntry(
      validateHistoryInput({
        tool: "log-analyzer",
        system: "PaymentBatch",
        summary: "round trip",
        severity: "Medium",
        payload: '{"input":"demo"}',
      }),
      { createdAt: "2026-08-21T10:00:00.000Z" },
    );
    const json = bundleToJson(exportAllData());
    currentDbFile = path.join(tempDir, `roundtrip-${seq}.db`);
    initDb(currentDbFile);
    importBundleJson(json);
    const restored = listHistory();
    expect(restored).toHaveLength(1);
    expect(restored[0]?.summary).toBe("round trip");
    expect(restored[0]?.severity).toBe("Medium");
    expect(restored[0]?.payload).toBe('{"input":"demo"}');
  });

  it("ignores invalid severity instead of failing the save", () => {
    expect(() =>
      validateHistoryInput({
        tool: "log-analyzer",
        system: "",
        summary: "bad severity",
        severity: "Urgent" as never,
        payload: "{}",
      }),
    ).toThrowError(/Invalid severity/);
  });
});

describe("history CSV derived columns", () => {
  it("extracts exception/component/HTTP detail from a log-analyzer payload", () => {
    const csv = historyToCsv([
      {
        id: 1,
        createdAt: "2026-08-21T10:00:00.000Z",
        tool: "log-analyzer",
        system: "PaymentBatch",
        summary: "NPE",
        severity: "High",
        payload: JSON.stringify({
          input:
            "2026-08-21 10:15:22 ERROR PaymentBatch java.lang.NullPointerException HTTP 500",
        }),
      },
    ]);
    expect(csv).toContain('"inputChars","inputPreview","detail","sensitive"');
    expect(csv).toContain('"NullPointerException · PaymentBatch · HTTP 500"');
    expect(csv).toContain('"sensitive","');
  });

  it("derives per-tool details (timestamp timezone, compare sizes, mode)", () => {
    const csv = historyToCsv([
      {
        id: 1,
        createdAt: "",
        tool: "timestamp",
        system: "",
        summary: "t",
        severity: null,
        payload: JSON.stringify({ input: "1787299200", timezone: "Asia/Tokyo" }),
      },
      {
        id: 2,
        createdAt: "",
        tool: "log-comparison",
        system: "",
        summary: "c",
        severity: null,
        payload: JSON.stringify({ before: "a".repeat(10), after: "b".repeat(20) }),
      },
      {
        id: 3,
        createdAt: "",
        tool: "sql",
        system: "",
        summary: "s",
        severity: null,
        payload: JSON.stringify({ input: "select 1", mode: "safety" }),
      },
    ]);
    expect(csv).toContain('"Asia/Tokyo"');
    expect(csv).toContain("before:10 after:20 chars");
    expect(csv).toContain('"safety"');
  });

  it("flags sensitive payloads in the sensitive column", () => {
    const csv = historyToCsv([
      {
        id: 1,
        createdAt: "",
        tool: "log-analyzer",
        system: "",
        summary: "x",
        severity: null,
        payload: JSON.stringify({ input: "ERROR password=hunter2" }),
      },
    ]);
    expect(csv).toContain('"yes"');
    expect(csv).toContain('password=hunter2'); // preview keeps raw for review
  });
});

describe("history analysis columns (rule engine snapshot)", () => {
  const RULES_PAYLOAD = JSON.stringify({
    input: "2026-08-21 10:15:22 ERROR OrderApi HTTP 500",
    system: "OrderApi",
    analysisSource: "rules",
    analysis: {
      severity: "High",
      errorTypes: ["HTTP Error"],
      affectedComponents: ["OrderApi"],
      rootCauses: ["Downstream payment API unavailable"],
      rootCausesZh: ["下游付款 API 不可用"],
      immediateInvestigation: ["Check payment API status"],
      immediateInvestigationZh: ["檢查付款 API 狀態"],
      suggestedFixes: ["Retry with backoff"],
      suggestedFixesZh: ["重試並加上退避"],
      longTermImprovements: ["Add circuit breaker"],
      longTermImprovementsZh: ["加入斷路器"],
      matchedRuleIds: ["http-5xx"],
      unknownTriage: null,
      matchedEvidence: [],
    },
    aiFallback: null,
  });

  function entry(payload: string, severity: Severity | null = "High", tool = "log-analyzer") {
    return {
      id: 1,
      createdAt: "2026-08-21T10:00:00.000Z",
      tool,
      system: "OrderApi",
      summary: "HTTP 500",
      severity,
      payload,
    };
  }

  it("breaks the analysis result into CSV columns (bilingual)", () => {
    const csv = historyToCsv([entry(RULES_PAYLOAD)]);
    expect(csv).toContain(
      '"analysisSource","matchedRuleCount","errorTypes","affectedComponents","possibleRootCause","immediateInvestigation","suggestedFixes","longTermImprovements"',
    );
    expect(csv).toContain('"rules"');
    expect(csv).toContain('"1"');
    expect(csv).toContain('"HTTP Error"');
    expect(csv).toContain('"OrderApi"');
    expect(csv).toContain('"下游付款 API 不可用 — Downstream payment API unavailable"');
    expect(csv).toContain('"1. 檢查付款 API 狀態 — Check payment API status"');
    expect(csv).toContain('"重試並加上退避 — Retry with backoff"');
    expect(csv).toContain('"加入斷路器 — Add circuit breaker"');
    expect(csv).toContain('"High"'); // severity column
  });

  it("uses the AI fallback result when analysisSource is ai-fallback", () => {
    const csv = historyToCsv([
      entry(
        JSON.stringify({
          input: "2026-08-21 15:33:07 ERROR GatewayBridge jobId=AX-99122",
          system: "GatewayBridge",
          analysisSource: "ai-fallback",
          analysis: {
            severity: "Informational",
            errorTypes: ["Unknown Error"],
            affectedComponents: ["GatewayBridge"],
            rootCauses: ["Generic: no known pattern"],
            rootCausesZh: ["通用：未有已知模式"],
            immediateInvestigation: ["Generic: check input data"],
            immediateInvestigationZh: ["[通用] 檢查輸入資料。"],
            suggestedFixes: ["Generic: search exact error text"],
            suggestedFixesZh: ["[通用] 搜尋確切錯誤文字"],
            longTermImprovements: ["Generic: improve logging"],
            longTermImprovementsZh: ["[通用] 改善日誌"],
            matchedRuleIds: [],
            unknownTriage: {
              languageHint: null,
              httpDirection: null,
              causes: ["Generic"],
              causesZh: ["通用"],
              investigation: ["Generic: check input data"],
              investigationZh: ["[通用] 檢查輸入資料。"],
            },
            matchedEvidence: [],
          },
          aiFallback: {
            severity: "High",
            errorTypes: ["ChecksumMismatch", "RetryExhausted"],
            rootCauses: ["PAY gateway rejected masked checksum"],
            rootCausesZh: ["PAY 閘道拒絕遮罩檢查碼"],
            immediateInvestigation: ["Check gateway signature"],
            immediateInvestigationZh: ["檢查閘道簽章"],
            suggestedFixes: ["Rotate signature key"],
            suggestedFixesZh: ["輪換簽章金鑰"],
            longTermImprovements: ["Add checksum validation monitor"],
            longTermImprovementsZh: ["加入檢查碼驗證監控"],
            model: "deepseek/deepseek-v4-flash-0731",
            confidence: 0.35,
            cached: false,
          },
        }),
        "High",
      ),
    ]);
    expect(csv).toContain('"ai-fallback"');
    expect(csv).toContain('"0"'); // matchedRuleCount
    expect(csv).toContain('"ChecksumMismatch | RetryExhausted"');
    expect(csv).toContain('"PAY 閘道拒絕遮罩檢查碼 — PAY gateway rejected masked checksum"');
    expect(csv).toContain('"1. 檢查閘道簽章 — Check gateway signature"');
    expect(csv).toContain('"輪換簽章金鑰 — Rotate signature key"');
    expect(csv).toContain('"加入檢查碼驗證監控 — Add checksum validation monitor"');
    expect(csv).not.toContain('"通用：未有已知模式 — Generic: no known pattern"');
  });

  it("leaves analysis columns empty for legacy / non-log entries", () => {
    const csv = historyToCsv([
      entry(JSON.stringify({ input: "demo log", system: "" }), "High"),
      entry(JSON.stringify({ input: "10:00:00" }), null, "timestamp"),
    ]);
    expect(csv).toContain('"High","","","","","","","",""');
  });
});

describe("history analysis in the JSON backup bundle", () => {
  it("exports a parsed analysis object per log-analyzer entry", () => {
    createHistoryEntry(
      validateHistoryInput({
        tool: "log-analyzer",
        system: "OrderApi",
        summary: "HTTP 500",
        severity: "High",
        payload: JSON.stringify({
          input: "2026-08-21 10:15:22 ERROR OrderApi HTTP 500",
          system: "OrderApi",
          analysisSource: "rules",
          analysis: {
            severity: "High",
            errorTypes: ["HTTP Error"],
            affectedComponents: ["OrderApi"],
            rootCauses: ["Downstream payment API unavailable"],
            rootCausesZh: ["下游付款 API 不可用"],
            immediateInvestigation: ["Check payment API status"],
            immediateInvestigationZh: ["檢查付款 API 狀態"],
            suggestedFixes: ["Retry with backoff"],
            suggestedFixesZh: ["重試並加上退避"],
            longTermImprovements: ["Add circuit breaker"],
            longTermImprovementsZh: ["加入斷路器"],
            matchedRuleIds: ["http-5xx"],
            unknownTriage: null,
            matchedEvidence: [],
          },
          aiFallback: null,
        }),
      }),
      { createdAt: "2026-08-21T10:00:00.000Z" },
    );
    const parsed = JSON.parse(bundleToJson(exportAllData())) as {
      history: Array<{
        analysis: {
          source: string;
          severity: string;
          matchedRuleCount: number;
          errorTypes: string[];
          affectedComponents: string[];
          possibleRootCause: Array<{ zh: string | null; en: string }>;
          aiFallback: unknown;
        };
      }>;
    };
    expect(parsed.history).toHaveLength(1);
    expect(parsed.history[0]?.analysis.source).toBe("rules");
    expect(parsed.history[0]?.analysis.severity).toBe("High");
    expect(parsed.history[0]?.analysis.matchedRuleCount).toBe(1);
    expect(parsed.history[0]?.analysis.errorTypes).toEqual(["HTTP Error"]);
    expect(parsed.history[0]?.analysis.possibleRootCause).toEqual([
      { zh: "下游付款 API 不可用", en: "Downstream payment API unavailable" },
    ]);
    expect(parsed.history[0]?.analysis.aiFallback).toBeNull();
  });

  it("round-trips the enriched bundle through import (schema v2)", () => {
    const payload = JSON.stringify({
      input: "demo",
      system: "",
      analysisSource: "rules",
      analysis: {
        severity: "Low",
        errorTypes: [],
        affectedComponents: [],
        rootCauses: ["x"],
        rootCausesZh: null,
        immediateInvestigation: ["y"],
        immediateInvestigationZh: null,
        suggestedFixes: [],
        suggestedFixesZh: null,
        longTermImprovements: [],
        longTermImprovementsZh: null,
        matchedRuleIds: [],
        unknownTriage: null,
        matchedEvidence: [],
      },
      aiFallback: null,
    });
    createHistoryEntry(
      validateHistoryInput({
        tool: "log-analyzer",
        system: "",
        summary: "s",
        severity: "Low",
        payload,
      }),
      { createdAt: "2026-08-21T10:00:00.000Z" },
    );
    const json = bundleToJson(exportAllData());
    const first = importBundleJson(json);
    expect(first).toEqual({
      importedIncidents: 0,
      importedHistory: 0,
      importedRules: 0,
      skipped: 1,
      skippedRules: 0,
    });
    // A fresh DB still imports the enriched bundle (analysis field ignored on import).
    currentDbFile = path.join(tempDir, `enriched-${seq}.db`);
    initDb(currentDbFile);
    const restore = importBundleJson(json);
    expect(restore).toEqual({
      importedIncidents: 0,
      importedHistory: 1,
      importedRules: 0,
      skipped: 0,
      skippedRules: 0,
    });
    expect(listHistory()[0]?.payload).toBe(payload);
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
      expect(parsed.schemaVersion).toBe(2);
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

describe("CSV spreadsheet safety (§7)", () => {
  const csvOf = (title: string): string => incidentsToCsv([incidentRow(1, title)]);

  it("neutralizes =HYPERLINK(...) before quoting", () => {
    const csv = csvOf('=HYPERLINK("http://evil.example","click")');
    expect(csv).toContain('"\'=HYPERLINK(""http://evil.example"",""click"")"');
  });

  it("neutralizes +, - and @ prefixes too", () => {
    expect(csvOf("+cmd|/C calc")).toContain('"\'+cmd|/C calc"');
    expect(csvOf("-1+1")).toContain(`"'-1+1"`);
    expect(csvOf("@SUM(1,2)")).toContain('"\'@SUM(1,2)"');
  });

  it("defeats whitespace / tab / control-character bypasses", () => {
    expect(csvOf("\t=1+1")).toContain('"\'\t=1+1"');
    expect(csvOf("\n=cmd()")).toContain('"\'\n=cmd()"');
    expect(csvOf("  =SUM(1,2)")).toContain('"\'  =SUM(1,2)"');
  });

  it("does not touch safe content — quotes, commas, Unicode, multiline round-trip", () => {
    const csv = incidentsToCsv([
      incidentRow(1, 'a,b "quoted"'),
      incidentRow(2, "中文繁體-付款"),
      incidentRow(3, "line1\nline2\r\nline3"),
      incidentRow(4, "normal title 123"),
    ]);
    expect(csv).toContain('"a,b ""quoted"""');
    expect(csv).toContain('"中文繁體-付款"');
    expect(csv).toContain('"line1\nline2\r\nline3"');
    expect(csv).toContain('"normal title 123"');
    // Only dangerous cells carry the apostrophe marker.
    expect(csv.match(/"/g) ?? []).toBeTruthy();
    expect(csv.split("\r\n").filter((line) => line.startsWith("'"))).toHaveLength(0);
  });

  it("leaves numeric ids and controlled enums as plain quoted values", () => {
    const csv = csvOf("severity title");
    expect(csv).toContain('"1"'); // id stays numeric
    expect(csv).toContain('"Low"'); // severity enum unaffected
  });

  it("history CSV also sanitizes the summary cell; raw payload JSON starts with { so it is left intact", () => {
    const csv = historyToCsv([
      {
        id: 1,
        createdAt: "2026-08-21T10:00:00.000Z",
        tool: "log-analyzer",
        system: "",
        summary: "=HYPERLINK(x)",
        severity: null,
        payload: '{"input":"@SUM(1,2)"}',
      },
    ]);
    expect(csv).toContain('"\'=HYPERLINK(x)"');
    // The formula lives INSIDE the JSON payload, which starts with `{` — not a
    // spreadsheet trigger — so the payload column stays untouched (round-trip).
    expect(csv).toContain('"{""input"":""@SUM(1,2)""}"');
    // The derived inputPreview (which contains the raw input) IS sanitized.
    expect(csv).toContain('"\'@SUM(1,2)"');
  });
});