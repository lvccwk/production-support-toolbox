import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, initDb } from "./db";
import {
  allSettings,
  getSetting,
  isAuditEnabled,
  isMaskingEnabled,
  setSetting,
} from "./settings";

let tempDir: string;
let seq = 0;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pst-settings-"));
});

beforeEach(() => {
  seq += 1;
  initDb(path.join(tempDir, `test-${seq}.db`));
});

afterAll(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("settings store", () => {
  it("defaults: masking on, audit off", () => {
    expect(isMaskingEnabled()).toBe(true);
    expect(isAuditEnabled()).toBe(false);
  });

  it("round-trips values and overwrites", () => {
    expect(getSetting("privacy:audit")).toBeNull();
    setSetting("privacy:audit", "1");
    expect(getSetting("privacy:audit")).toBe("1");
    setSetting("privacy:audit", "0");
    expect(getSetting("privacy:audit")).toBe("0");
    expect(allSettings()["privacy:audit"]).toBe("0");
  });

  it("toggles privacy behaviour", () => {
    setSetting("privacy:masking", "0");
    expect(isMaskingEnabled()).toBe(false);
    setSetting("privacy:audit", "1");
    expect(isAuditEnabled()).toBe(true);
  });
});