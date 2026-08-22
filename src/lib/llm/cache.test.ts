import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, initDb } from "@/lib/database/db";
import { analysisCacheKey, getCachedAnalysis, putCachedAnalysis } from "./cache";

let tempDir: string;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pst-cache-"));
  initDb(path.join(tempDir, "test.db"));
});

afterAll(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const sample = { severity: "High", rootCause: "cached cause" };

/** Cache-key helper: every entry carries the provider that produced it. */
function key(overrides: Partial<{ tool: string; input: string; model: string; provider: string }> = {}) {
  return analysisCacheKey({
    tool: "log-analyzer",
    input: "abc",
    model: "m",
    provider: "openrouter",
    ...overrides,
  });
}

describe("analysis cache", () => {
  it("misses on empty cache", () => {
    expect(getCachedAnalysis(key())).toBeNull();
  });

  it("round-trips a stored result", () => {
    const cacheKey = key();
    putCachedAnalysis(cacheKey, "log-analyzer", "m", sample);
    expect(getCachedAnalysis(cacheKey)).toEqual(sample);
  });

  it("is stable for identical inputs and distinct for changed ones", () => {
    const base = { tool: "log-analyzer", input: "same log", model: "m", provider: "openrouter" };
    expect(analysisCacheKey(base)).toBe(analysisCacheKey(base));
    expect(analysisCacheKey(base)).not.toBe(
      analysisCacheKey({ ...base, model: "other" }),
    );
    expect(analysisCacheKey(base)).not.toBe(
      analysisCacheKey({ ...base, input: "other log" }),
    );
    // Different transport => different cache bucket.
    expect(analysisCacheKey(base)).not.toBe(
      analysisCacheKey({ ...base, provider: "ollama" }),
    );
  });

  it("overwrites on conflict with the same key", () => {
    const cacheKey = key();
    putCachedAnalysis(cacheKey, "log-analyzer", "m", { severity: "Low" });
    expect(getCachedAnalysis(cacheKey)).toEqual({ severity: "Low" });
  });
});