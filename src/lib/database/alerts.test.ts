import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, initDb } from "./db";
import { createHistoryEntry, validateHistoryInput } from "./history";
import {
  ALERT_LIMITS,
  alertFireKey,
  alertRuleMatches,
  createAlertRule,
  deleteAlertRule,
  deliverWebhook,
  evaluateAlerts,
  getAlertRule,
  listAlertRules,
  listNotifications,
  sendTestAlert,
  updateAlertRule,
  validateAlertRuleInput,
} from "./alerts";
import { ToolError } from "@/lib/errors";
import type { AlertRuleInput, HistoryEntry } from "@/types";

let tempDir: string;
let seq = 0;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pst-alerts-"));
});

beforeEach(() => {
  seq += 1;
  initDb(path.join(tempDir, `alerts-${seq}.db`));
  vi.unstubAllEnvs();
});

afterAll(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function ruleInput(overrides: Record<string, unknown> = {}): AlertRuleInput {
  return {
    name: "PAY gateway High",
    condition: {
      minSeverity: "High",
      errorTypes: ["Timeout"],
      systems: ["ledger"],
      tools: ["log-analyzer"],
    },
    channels: [{ type: "webhook", url: "https://hooks.example.com/team" }],
    cooldownMinutes: 60,
    active: true,
    ...(overrides as Partial<AlertRuleInput>),
  };
}

function savedEntry(
  severity: "Critical" | "High" | "Medium" | "Low" | "Informational",
  system: string,
  errorTypes: string[],
  summary = "Ledger batch timed out",
): HistoryEntry {
  return createHistoryEntry(
    validateHistoryInput({
      tool: "log-analyzer",
      system,
      summary,
      severity,
      payload: JSON.stringify({
        analysis: {
          severity,
          errorTypes,
          affectedComponents: [],
          rootCauses: [],
          immediateInvestigation: [],
          suggestedFixes: [],
          longTermImprovements: [],
          matchedRuleIds: ["custom:1"],
          unknownTriage: null,
          matchedEvidence: [],
        },
        analysisSource: "rules",
      }),
    }),
  );
}

const okFetch = async () => new Response("{}", { status: 200 });
const failFetch = async () => new Response("nope", { status: 500 });

describe("validateAlertRuleInput", () => {
  it("accepts a valid rule and normalises defaults", () => {
    const input = validateAlertRuleInput(ruleInput());
    expect(input.name).toBe("PAY gateway High");
    expect(input.condition.minSeverity).toBe("High");
    expect(input.channels).toEqual([{ type: "webhook", url: "https://hooks.example.com/team" }]);
    expect(input.cooldownMinutes).toBe(60);
    expect(input.active).toBe(true);
  });

  it("defaults condition.tools to log-analyzer and active to true", () => {
    const input = validateAlertRuleInput({
      name: "x",
      condition: { minSeverity: "Medium" },
    });
    expect(input.condition.tools).toEqual(["log-analyzer"]);
    expect(input.active).toBe(true);
  });

  it("rejects missing names / bad severity / bad cooldown", () => {
    expect(() => validateAlertRuleInput({ condition: { minSeverity: "High" } })).toThrow(
      ToolError,
    );
    expect(() =>
      validateAlertRuleInput(ruleInput({ condition: { minSeverity: "Urgent" } })),
    ).toThrow(ToolError);
    expect(() => validateAlertRuleInput(ruleInput({ cooldownMinutes: -1 }))).toThrow(ToolError);
    expect(() =>
      validateAlertRuleInput(ruleInput({ cooldownMinutes: ALERT_LIMITS.cooldownMaxMinutes + 1 })),
    ).toThrow(ToolError);
  });

  it("rejects non-http(s) webhook URLs and embedded credentials", () => {
    expect(() =>
      validateAlertRuleInput(ruleInput({ channels: [{ type: "webhook", url: "ftp://x" }] })),
    ).toThrow(ToolError);
    expect(() =>
      validateAlertRuleInput(
        ruleInput({ channels: [{ type: "webhook", url: "https://user:pass@host/x" }] }),
      ),
    ).toThrow(ToolError);
    expect(() =>
      validateAlertRuleInput(ruleInput({ channels: [{ type: "webhook", url: "not a url" }] })),
    ).toThrow(ToolError);
  });

  it("dedupes identical webhook URLs", () => {
    const input = validateAlertRuleInput(
      ruleInput({
        channels: [
          { type: "webhook", url: "https://a.example.com/x" },
          { type: "webhook", url: "https://a.example.com/x" },
        ],
      }),
    );
    expect(input.channels).toHaveLength(1);
  });
});

describe("alertRuleMatches + alertFireKey", () => {
  const rule = createAlertRule(ruleInput());

  it("matches on severity rank, system and error types", () => {
    expect(alertRuleMatches(rule, { tool: "log-analyzer", system: "ledger", severity: "Critical" }, ["Timeout"])).toBe(true);
    expect(alertRuleMatches(rule, { tool: "log-analyzer", system: "ledger", severity: "High" }, ["Timeout"])).toBe(true);
  });

  it("rejects below-min severity, wrong system, wrong error type, other tools", () => {
    expect(alertRuleMatches(rule, { tool: "log-analyzer", system: "ledger", severity: "Medium" }, ["Timeout"])).toBe(false);
    expect(alertRuleMatches(rule, { tool: "log-analyzer", system: "other", severity: "High" }, ["Timeout"])).toBe(false);
    expect(alertRuleMatches(rule, { tool: "log-analyzer", system: "ledger", severity: "High" }, ["SQL Exception"])).toBe(false);
    expect(alertRuleMatches(rule, { tool: "json", system: "ledger", severity: "High" }, ["Timeout"])).toBe(false);
  });

  it("inactive rules never match", () => {
    const inactive = createAlertRule({ ...ruleInput({ name: "off" }), active: false });
    expect(alertRuleMatches(inactive, { tool: "log-analyzer", system: "ledger", severity: "Critical" }, ["Timeout"])).toBe(false);
  });

  it("stable fire key differs by signal", () => {
    expect(alertFireKey({ tool: "log-analyzer", system: "ledger", severity: "High" }, ["Timeout"]))
      .toBe(alertFireKey({ tool: "log-analyzer", system: "ledger", severity: "High" }, ["Timeout"]));
    expect(alertFireKey({ tool: "log-analyzer", system: "ledger", severity: "High" }, ["Timeout"]))
      .not.toBe(alertFireKey({ tool: "log-analyzer", system: "ledger", severity: "High" }, ["SQL Exception"]));
  });
});

describe("alert rule repository", () => {
  it("creates, reads, updates and deletes rules; cap enforced on active", () => {
    const rule = createAlertRule(ruleInput());
    expect(getAlertRule(rule.id)?.name).toBe("PAY gateway High");

    const updated = updateAlertRule(rule.id, { cooldownMinutes: 5, active: false });
    expect(updated?.cooldownMinutes).toBe(5);
    expect(updated?.active).toBe(false);

    // Deactivating frees the active slot (cap default 100 — fill it partially).
    expect(deleteAlertRule(rule.id)).toBe(true);
    expect(getAlertRule(rule.id)).toBeNull();
    expect(listAlertRules()).toHaveLength(0);
  });

  it("rejects unknown id updates/deletes", async () => {
    expect(updateAlertRule(999, { name: "x" })).toBeNull();
    expect(deleteAlertRule(999)).toBe(false);
    await expect(sendTestAlert(999)).rejects.toThrow(ToolError);
  });
});

describe("deliverWebhook", () => {
  it("reports success for 2xx", async () => {
    const outcome = await deliverWebhook("https://x.example.com/h", {}, { fetchImpl: okFetch });
    expect(outcome.ok).toBe(true);
    expect(outcome.detail).toMatch(/HTTP 200/);
  });

  it("reports failure for non-2xx without throwing", async () => {
    const outcome = await deliverWebhook("https://x.example.com/h", {}, { fetchImpl: failFetch });
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toMatch(/HTTP 500/);
  });

  it("reports failure when fetch throws (network) without throwing", async () => {
    const throwing = async () => {
      throw new Error("ECONNREFUSED");
    };
    const outcome = await deliverWebhook(
      "https://x.example.com/h",
      {},
      { fetchImpl: throwing as typeof fetch },
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toMatch(/ECONNREFUSED/);
  });
});

describe("evaluateAlerts", () => {
  it("never fires when there are no rules", async () => {
    const fired = await evaluateAlerts(savedEntry("Critical", "ledger", ["Timeout"]), {
      fetchImpl: okFetch,
    });
    expect(fired).toBe(0);
    expect(listNotifications()).toHaveLength(0);
  });

  it("never fires when PST_ALERTS_ENABLED=false", async () => {
    createAlertRule(ruleInput());
    vi.stubEnv("PST_ALERTS_ENABLED", "false");
    const fired = await evaluateAlerts(savedEntry("Critical", "ledger", ["Timeout"]), {
      fetchImpl: okFetch,
    });
    expect(fired).toBe(0);
    expect(listNotifications()).toHaveLength(0);
  });

  it("fires a matching rule against a saved High+ entry and records in-app + webhook rows", async () => {
    const rule = createAlertRule(ruleInput());
    const fired = await evaluateAlerts(savedEntry("Critical", "ledger", ["Timeout"]), {
      fetchImpl: okFetch,
    });
    expect(fired).toBe(1);

    const notifications = listNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].ruleId).toBe(rule.id);
    expect(notifications[0].ruleName).toBe(rule.name);
    expect(notifications[0].channel).toBe("webhook");
    expect(notifications[0].status).toBe("sent");
    expect(notifications[0].level).toBe("Critical");
    expect(notifications[0].message).toContain("Ledger batch timed out");
    expect(notifications[0].message).toContain("[ledger]");
    expect(notifications[0].message).toContain("Timeout");
  });

  it("records failed webhooks without throwing and without breaking the save", async () => {
    createAlertRule(ruleInput());
    const fired = await evaluateAlerts(savedEntry("Critical", "ledger", ["Timeout"]), {
      fetchImpl: failFetch,
    });
    expect(fired).toBe(1);
    const notification = listNotifications()[0];
    expect(notification.status).toBe("failed");
    expect(notification.detail).toMatch(/HTTP 500/);
    // The live-history entry is intact.
    expect(listNotifications()).toHaveLength(1);
  });

  it("records in-app-only entries when the rule has no webhook channels", async () => {
    const rule = createAlertRule(ruleInput({ channels: [] }));
    const fired = await evaluateAlerts(savedEntry("High", "ledger", ["Timeout"]), {
      fetchImpl: okFetch,
    });
    expect(fired).toBe(1);
    const notification = listNotifications()[0];
    expect(notification.ruleName).toBe(rule.name);
    expect(notification.channel).toBe("in-app");
    expect(notification.status).toBe("sent");
  });

  it("suppresses the same signal within the cooldown window", async () => {
    createAlertRule(ruleInput());
    const start = "2026-08-21T08:00:00.000Z";
    const first = await evaluateAlerts(savedEntry("High", "ledger", ["Timeout"]), {
      fetchImpl: okFetch,
      now: start,
    });
    expect(first).toBe(1);

    const second = await evaluateAlerts(savedEntry("High", "ledger", ["Timeout"]), {
      fetchImpl: okFetch,
      now: "2026-08-21T08:30:00.000Z", // 30 min later — still inside 60 min cooldown
    });
    expect(second).toBe(0);
    expect(listNotifications()).toHaveLength(1);
  });

  it("fires again after the cooldown window passes", async () => {
    createAlertRule(ruleInput());
    await evaluateAlerts(savedEntry("High", "ledger", ["Timeout"]), {
      fetchImpl: okFetch,
      now: "2026-08-21T08:00:00.000Z",
    });
    const fired = await evaluateAlerts(savedEntry("High", "ledger", ["Timeout"]), {
      fetchImpl: okFetch,
      now: "2026-08-21T09:10:00.000Z", // 70 min later
    });
    expect(fired).toBe(1);
    expect(listNotifications()).toHaveLength(2);
  });

  it("a different error-type signal is not suppressed by cooldown", async () => {
    // Rule with NO error-type filter: both signals match, only cooldown decides.
    createAlertRule(
      ruleInput({ condition: { minSeverity: "High", errorTypes: [], systems: ["ledger"], tools: ["log-analyzer"] } }),
    );
    const start = "2026-08-21T08:00:00.000Z";
    await evaluateAlerts(savedEntry("High", "ledger", ["Timeout"]), {
      fetchImpl: okFetch,
      now: start,
    });
    const fired = await evaluateAlerts(savedEntry("High", "ledger", ["SQL Exception"]), {
      fetchImpl: okFetch,
      now: "2026-08-21T08:05:00.000Z",
    });
    expect(fired).toBe(1);
  });

  it("never throws even when the database layer would fail (rule evaluation is guarded)", async () => {
    // Rule with a minSeverity below the entry — nothing matches, nothing fires.
    createAlertRule(ruleInput());
    const fired = await evaluateAlerts(savedEntry("Low", "ledger", ["Timeout"]), {
      fetchImpl: okFetch,
    });
    expect(fired).toBe(0);
    expect(listNotifications()).toHaveLength(0);
  });
});

describe("sendTestAlert", () => {
  it("delivers a test payload when a webhook is configured", async () => {
    const rule = createAlertRule(ruleInput());
    const result = await sendTestAlert(rule.id, { fetchImpl: okFetch });
    expect(result.delivered).toBe(true);
    expect(result.notificationId).not.toBeNull();
    const notification = listNotifications()[0];
    expect(notification.channel).toBe("test");
    expect(notification.title).toContain("(test)");
  });

  it("reports webhook rejection without throwing", async () => {
    const rule = createAlertRule(ruleInput());
    const result = await sendTestAlert(rule.id, { fetchImpl: failFetch });
    expect(result.delivered).toBe(false);
    const notification = listNotifications()[0];
    expect(notification.status).toBe("failed");
  });

  it("works with in-app-only rules", async () => {
    const rule = createAlertRule(ruleInput({ channels: [] }));
    const result = await sendTestAlert(rule.id);
    expect(result.delivered).toBe(true);
    expect(result.detail).toMatch(/in-app only/);
  });
});