import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  runAnalyze,
  runCompare,
  runEncoding,
  runJson,
  runSql,
  runTimestamp,
} from "./runners";
import { ToolError } from "@/lib/errors";
import { closeDb, initDb } from "@/lib/database/db";

/**
 * Unit tests for the shared tool runners (src/lib/tools/runners.ts) — the
 * SINGLE implementation behind both the HTTP Agent API and the MCP server.
 * These tests pin the surface every consumer (routes + MCP) is built on:
 * inputs, validation messages and result shapes.
 */

describe("runAnalyze", () => {
  let tempDir: string;
  let seq = 0;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pst-runners-"));
  });

  beforeEach(() => {
    seq += 1;
    initDb(path.join(tempDir, `analyze-${seq}.db`));
  });

  afterAll(() => {
    closeDb();
  });

  it("analyses a rule-matching log with bilingual fields and evidence", async () => {
    const result = await runAnalyze({
      logs: "2026-08-21 10:15:22 ERROR PaymentBatch java.lang.NullPointerException at PaymentService.java:125",
      system: "PaymentBatch",
    });
    expect(result.analysisSource).toBe("rules");
    expect(result.severity).toBeTruthy();
    expect(result.errorTypes).toContain("NullPointerException");
    expect(result.matchedRuleIds.length).toBeGreaterThan(0);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.rootCausesZh?.length).toBe(result.rootCauses.length);
    expect(result.suggestedFixesZh?.length).toBe(result.suggestedFixes.length);
    // Extracted fields survive the pipeline.
    expect(result.extracted.exceptions).toContain("NullPointerException");
    expect(result.extracted.sources).toEqual(
      expect.arrayContaining([expect.objectContaining({ file: "PaymentService.java" })]),
    );
    expect(result.extracted.components).toContain("PaymentBatch");
    expect(result.logCount).toBe(1);
    expect(result.appliedCustomRules).toEqual([]);
    expect(result.aiFallbackConfigured).toBe(false);
  });

  it("accepts a string or an array of logs and masks sensitive values", async () => {
    const single = await runAnalyze({ logs: "ERROR timeout calling api" });
    const multi = await runAnalyze({
      logs: ["ERROR timeout calling api", "ERROR connection refused"],
    });
    expect(single.logCount).toBe(1);
    expect(multi.logCount).toBe(2);

    const masked = await runAnalyze({
      logs: "ERROR password=hunter2 calling api",
    });
    expect(masked.maskedKeys).toContain("password");
  });

  it("reports aiFallbackError when disabled and zero rules match", async () => {
    const result = await runAnalyze({
      logs: "INFO everyting is fine and dandy here",
      system: "UnknownSystem",
    });
    expect(result.matchedRuleIds).toEqual([]);
    expect(result.analysisSource).toBe("rules");
    expect(result.aiFallbackError).toContain("disabled");
  });

  it("throws ToolError for empty or oversized input", async () => {
    await expect(runAnalyze({ logs: "" })).rejects.toThrow(ToolError);
    await expect(runAnalyze({ logs: "   " })).rejects.toThrow(ToolError);
    await expect(runAnalyze({ logs: Array(6).fill("x") })).rejects.toThrow(/Too many logs/);
    await expect(runAnalyze({ logs: "x".repeat(600_001) })).rejects.toThrow(/too large/i);
  });
});

describe("runCompare", () => {
  it("detects new errors and a regression", () => {
    const result = runCompare(
      "HTTP 200\nINFO ok",
      "HTTP 500\njava.lang.NullPointerException",
    );
    expect(result.regression).toBe(true);
    expect(result.newErrors.length).toBeGreaterThan(0);
    expect(result.severityAfter).not.toBe(result.severityBefore);
  });

  it("validates both inputs", () => {
    expect(() => runCompare("", "after")).toThrow(ToolError);
    expect(() => runCompare("before", "")).toThrow(/after/);
  });
});

describe("runJson", () => {
  it("formats / validates / minifies / searches", () => {
    const formatted = runJson({ input: '{"b":1,"a":2}', action: "format" }) as { output: string };
    const minified = runJson({ input: '{"b":1,"a":2}', action: "minify" }) as { output: string };
    expect(formatted.output).toContain("\n");
    expect(minified.output).toBe('{"b":1,"a":2}');
    expect(runJson({ input: "{bad", action: "validate" })).toMatchObject({ valid: false });
    expect(runJson({ input: '{"name":"ABC"}', action: "search", query: "name" })).toMatchObject({
      hits: [{ path: "name", value: "ABC" }],
    });
  });

  it("rejects missing input and unknown actions", () => {
    expect(() => runJson({ input: "", action: "format" })).toThrow(ToolError);
    expect(() => runJson({ input: "{}", action: "explode" })).toThrow(/Unknown action/);
  });
});

describe("runSql", () => {
  it("formats / safety-checks / analyses", () => {
    const formatted = runSql({ input: "select a from t where b=1", action: "format" }) as {
      output: string;
    };
    const safety = runSql({ input: "DELETE FROM customer;", action: "safety" }) as {
      issues: Array<{ code: string }>;
    };
    expect(formatted.output).toContain("SELECT");
    expect(safety.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "DELETE_WITHOUT_WHERE" })]),
    );
    expect(runSql({ input: "SELECT * FROM orders WHERE id=1;", action: "analyze" })).toMatchObject({
      statementType: "SELECT",
    });
  });

  it("rejects unknown actions", () => {
    expect(() => runSql({ input: "select 1", action: "run" })).toThrow(/Unknown action/);
  });
});

describe("runTimestamp", () => {
  it("converts with the default and an explicit timezone", () => {
    const result = runTimestamp({ input: "2026-08-21 16:00:00" });
    expect(result.timezone).toBe("Asia/Hong_Kong");
    expect(result.unixSeconds).toBeGreaterThan(0);
    const ny = runTimestamp({ input: "2026-08-21 16:00:00", timezone: "America/New_York" });
    expect(ny.timezone).toBe("America/New_York");
  });

  it("rejects unsupported timezones and empty input", () => {
    expect(() => runTimestamp({ input: "2026-08-21", timezone: "Moon/Mare" })).toThrow(
      /Unsupported timezone/,
    );
    expect(() => runTimestamp({ input: "" })).toThrow(ToolError);
  });
});

describe("runEncoding", () => {
  it("runs every action", () => {
    expect(runEncoding({ input: "hello world", action: "base64-encode" }).output).toBe(
      "aGVsbG8gd29ybGQ=",
    );
    expect(runEncoding({ input: "aGVsbG8gd29ybGQ=", action: "base64-decode" }).output).toBe(
      "hello world",
    );
    expect(runEncoding({ input: "hello world", action: "url-encode" }).output).toBe(
      "hello%20world",
    );
    expect(runEncoding({ input: "hello%20world", action: "url-decode" }).output).toBe(
      "hello world",
    );
    expect(runEncoding({ input: "a/b c", action: "url-encode-path" }).output).toBe("a/b%20c");
  });

  it("rejects unknown actions and invalid base64", () => {
    expect(() => runEncoding({ input: "x", action: "rot13" })).toThrow(/Unknown action/);
    expect(() => runEncoding({ input: "!!!", action: "base64-decode" })).toThrow(/Invalid base64/);
  });
});