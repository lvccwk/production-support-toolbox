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

describe("analysis cache", () => {
  it("misses on empty cache", () => {
    const key = analysisCacheKey({ tool: "log-analyzer", input: "abc", model: "m" });
    expect(getCachedAnalysis(key)).toBeNull();
  });

  it("round-trips a stored result", () => {
    const key = analysisCacheKey({ tool: "log-analyzer", input: "abc", model: "m" });
    putCachedAnalysis(key, "log-analyzer", "m", sample);
    expect(getCachedAnalysis(key)).toEqual(sample);
  });

  it("is stable for identical inputs and distinct for changed ones", () => {
    const base = { tool: "log-analyzer", input: "same log", model: "m" };
    expect(analysisCacheKey(base)).toBe(analysisCacheKey(base));
    expect(analysisCacheKey(base)).not.toBe(
      analysisCacheKey({ ...base, model: "other" }),
    );
    expect(analysisCacheKey(base)).not.toBe(
      analysisCacheKey({ ...base, input: "other log" }),
    );
  });

  it("overwrites on conflict with the same key", () => {
    const key = analysisCacheKey({ tool: "log-analyzer", input: "abc", model: "m" });
    putCachedAnalysis(key, "log-analyzer", "m", { severity: "Low" });
    expect(getCachedAnalysis(key)).toEqual({ severity: "Low" });
  });
});