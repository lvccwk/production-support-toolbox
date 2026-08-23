import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, initDb } from "@/lib/database/db";
import { createHistoryEntry, validateHistoryInput } from "@/lib/database/history";
import { dossierEnabled, dossierSignature, loadIncidentDossier } from "./dossier";

let tempDir: string;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pst-dossier-"));
  initDb(path.join(tempDir, "test.db"));
});

afterAll(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function save(system: string, summary: string) {
  return createHistoryEntry(
    validateHistoryInput({
      tool: "log-analyzer",
      system,
      summary,
      severity: "High",
      payload: "{}",
    }),
  );
}

describe("loadIncidentDossier", () => {
  it("recalls past incidents for the same system", () => {
    save("PaymentBatch", "NPE in batch");
    save("PaymentBatch", "timeout to DB2");
    save("BillingService", "unrelated system");

    const entries = loadIncidentDossier("PaymentBatch");
    expect(entries.length).toBe(2);
    expect(entries.map((e) => e.summary)).toEqual(
      expect.arrayContaining(["NPE in batch", "timeout to DB2"]),
    );
  });

  it("returns empty without a system or when disabled", () => {
    expect(loadIncidentDossier("")).toEqual([]);
    expect(dossierEnabled({ PST_DOSSIER: "off" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(
      loadIncidentDossier("PaymentBatch", 3, {
        PST_DOSSIER: "off",
      } as unknown as NodeJS.ProcessEnv),
    ).toEqual([]);
  });

  it("caps results to the limit", () => {
    save("CapSystem", "a");
    save("CapSystem", "b");
    save("CapSystem", "c");
    save("CapSystem", "d");
    expect(loadIncidentDossier("CapSystem", 3).length).toBeLessThanOrEqual(3);
  });

  it("produces a stable signature for cache keys", () => {
    const entries = loadIncidentDossier("PaymentBatch");
    expect(dossierSignature(entries)).toBe(dossierSignature(entries));
  });
});