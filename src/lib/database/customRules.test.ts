import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, getDb, initDb } from "./db";
import {
  bulkImportCustomRules,
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

describe("active cap only gates inactive -> active transitions (§8)", () => {
  it("lets an active rule be edited when the cap is full", () => {
    vi.stubEnv("PST_MAX_CUSTOM_RULES", "3");
    try {
      listCustomRules(false).forEach((rule) => deleteCustomRule(rule.id));
      const a = createCustomRule({ ...INPUT, name: "cap-a" });
      createCustomRule({ ...INPUT, name: "cap-b" });
      createCustomRule({ ...INPUT, name: "cap-c" });
      expect(countActiveCustomRules()).toBe(3);

      // Update an ACTIVE rule's content while the cap is full -> allowed.
      const updated = updateCustomRule(a.id, { rootCauses: ["new cause"] });
      expect(updated?.rootCauses).toEqual(["new cause"]);

      // Deactivate an active rule while the cap is full -> allowed.
      const deactivated = updateCustomRule(a.id, { active: false });
      expect(deactivated?.active).toBe(false);

      // Reactivating it now that there is room -> allowed.
      expect(updateCustomRule(a.id, { active: true })?.active).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects activating an inactive rule when the cap is full", () => {
    vi.stubEnv("PST_MAX_CUSTOM_RULES", "3");
    try {
      listCustomRules(false).forEach((rule) => deleteCustomRule(rule.id));
      createCustomRule({ ...INPUT, name: "full-1" });
      createCustomRule({ ...INPUT, name: "full-2" });
      createCustomRule({ ...INPUT, name: "full-3" });
      const dormant = createCustomRule({ ...INPUT, name: "dormant", active: false });
      expect(countActiveCustomRules()).toBe(3);

      expect(() => updateCustomRule(dormant.id, { active: true })).toThrowError(
        /limit reached/,
      );
      // Nothing changed: still inactive, still 3 actives.
      expect(getCustomRule(dormant.id)?.active).toBe(false);
      expect(countActiveCustomRules()).toBe(3);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("deactivating one rule frees a slot for another", () => {
    vi.stubEnv("PST_MAX_CUSTOM_RULES", "3");
    try {
      listCustomRules(false).forEach((rule) => deleteCustomRule(rule.id));
      createCustomRule({ ...INPUT, name: "swap-1" });
      createCustomRule({ ...INPUT, name: "swap-2" });
      createCustomRule({ ...INPUT, name: "swap-3" });
      const dormant = createCustomRule({ ...INPUT, name: "swap-dormant", active: false });

      const activeRule = listCustomRules(false).find((r) => r.active);
      expect(activeRule).toBeTruthy();
      updateCustomRule(activeRule!.id, { active: false });
      expect(updateCustomRule(dormant.id, { active: true })?.active).toBe(true);
      expect(countActiveCustomRules()).toBe(3);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("bulk import is truly atomic (§5)", () => {
  it("imports, skips duplicates and counts predictably", () => {
    listCustomRules(false).forEach((rule) => deleteCustomRule(rule.id));
    const first = bulkImportCustomRules([INPUT, { ...INPUT, name: "second", active: false }]);
    const again = bulkImportCustomRules([INPUT, { ...INPUT, name: "third" }]);
    expect(first).toEqual({ imported: 2, skipped: 0 });
    expect(again).toEqual({ imported: 1, skipped: 1 });
    // INPUT + third are active; second is inactive.
    expect(countActiveCustomRules()).toBe(2);
  });

  it("rejects the WHOLE batch when the active cap would be exceeded (no partial writes)", () => {
    vi.stubEnv("PST_MAX_CUSTOM_RULES", "3");
    try {
      listCustomRules(false).forEach((rule) => deleteCustomRule(rule.id));
      createCustomRule({ ...INPUT, name: "pre-existing" });
      expect(() =>
        bulkImportCustomRules([
          { ...INPUT, name: "batch-a" },
          { ...INPUT, name: "batch-b" },
          { ...INPUT, name: "batch-c" },
        ]),
      ).toThrowError(/limit reached/);
      // NOTHING from the batch was written.
      expect(listCustomRules(false).map((r) => r.name)).toEqual(["pre-existing"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rolls back cleanly when the N-th insert fails mid-transaction", () => {
    listCustomRules(false).forEach((rule) => deleteCustomRule(rule.id));
    const db = getDb();
    const originalPrepare = db.prepare.bind(db);
    let insertCalls = 0;
    const spy = vi.spyOn(db, "prepare").mockImplementation(
      ((sql: string) => {
        const stmt = originalPrepare(sql);
        if (sql.includes("INSERT INTO custom_rules")) {
          return {
            ...stmt,
            run: (...args: unknown[]) => {
              insertCalls += 1;
              if (insertCalls === 2) throw new Error("simulated insert failure #2");
              return stmt.run(...(args as Parameters<typeof stmt.run>));
            },
          } as typeof stmt;
        }
        return stmt;
      }) as typeof db.prepare,
    );
    try {
      expect(() => bulkImportCustomRules([INPUT, { ...INPUT, name: "second" }])).toThrowError(
        /simulated insert failure/,
      );
      expect(listCustomRules(false)).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});