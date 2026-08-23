import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb, initDb } from "./db";
import {
  countActiveCustomRules,
  createCustomRule,
  deleteCustomRule,
  getCustomRule,
  listCustomRules,
  updateCustomRule,
} from "./customRules";
import type { CustomRuleInput } from "@/types";

let tempDir: string;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pst-custom-"));
  initDb(path.join(tempDir, "test.db"));
});

afterAll(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const INPUT: CustomRuleInput = {
  name: "pay-step44-timeout",
  scope: { type: "components", values: ["PaymentBatch"] },
  patterns: ["STEP44.*timeout"],
  severity: "High",
  rootCauses: ["PAY gateway timeout"],
};

describe("custom rule repository", () => {
  it("creates, reads and lists", () => {
    const rule = createCustomRule(INPUT);
    expect(rule.id).toBeGreaterThan(0);
    expect(rule.name).toBe("pay-step44-timeout");
    expect(rule.scope.type).toBe("components");
    expect(rule.patterns).toEqual(["STEP44.*timeout"]);
    expect(getCustomRule(rule.id)?.severity).toBe("High");
    expect(listCustomRules().length).toBeGreaterThanOrEqual(1);
  });

  it("updates a rule", () => {
    const rule = createCustomRule({ ...INPUT, name: "temp" });
    const updated = updateCustomRule(rule.id, { severity: "Critical", name: "temp2" });
    expect(updated?.name).toBe("temp2");
    expect(updated?.severity).toBe("Critical");
    // Scope stayed because the update merges over the existing rule.
    expect(updated?.scope.type).toBe("components");
  });

  it("filters inactive rules", () => {
    const rule = createCustomRule({ ...INPUT, name: "inactive", active: false });
    expect(listCustomRules(true).some((r) => r.id === rule.id)).toBe(false);
    expect(listCustomRules(false).some((r) => r.id === rule.id)).toBe(true);
    expect(countActiveCustomRules()).toBeGreaterThanOrEqual(0);
  });

  it("deletes a rule", () => {
    const rule = createCustomRule({ ...INPUT, name: "to-delete" });
    expect(deleteCustomRule(rule.id)).toBe(true);
    expect(getCustomRule(rule.id)).toBeNull();
    expect(deleteCustomRule(rule.id)).toBe(false);
  });

  it("rejects invalid regex at the repository boundary", () => {
    expect(() =>
      createCustomRule({ ...INPUT, name: "bad", patterns: ["(" ] }),
    ).toThrowError(/Invalid pattern/);
  });

  it("preserves DB writes in the same schema (custom_rules table exists)", () => {
    const table = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='custom_rules'")
      .get();
    expect(table).toBeTruthy();
  });
});