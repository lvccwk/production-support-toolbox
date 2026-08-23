import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, initDb } from "@/lib/database/db";
import {
  buildFallbackContext,
  buildFallbackPrompt,
  resolveFallbackOptions,
  runFallback,
  validateFallbackAnalysis,
  type FallbackOptions,
} from "./fallback";

const VALID = {
  severity: "High",
  errorTypes: ["MysteryCrash"],
  rootCauses: ["unknown subsystem"],
  rootCausesZh: ["未知子系統"],
  immediateInvestigation: ["check service logs"],
  immediateInvestigationZh: ["檢查服務日誌"],
  suggestedFixes: ["restart"],
  suggestedFixesZh: ["重啟"],
  longTermImprovements: ["add tracing"],
  longTermImprovementsZh: ["加入追蹤"],
  confidence: 0.6,
};

function optionsWith(fetchImpl: typeof fetch, env: Partial<FallbackOptions> = {}): FallbackOptions {
  return {
    enabled: true,
    apiKey: "sk-or-test",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-v4-flash-0731",
    timeoutMs: 1000,
    fetchImpl,
    ...env,
  };
}

let tempDir: string;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pst-fallback-"));
  initDb(path.join(tempDir, "test.db"));
});

afterAll(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function chatResponse(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

describe("resolveFallbackOptions", () => {
  it("requires the enable flag AND a key", () => {
    expect(
      resolveFallbackOptions({ PST_AI_FALLBACK: "true" } as unknown as NodeJS.ProcessEnv).enabled,
    ).toBe(false);
    expect(
      resolveFallbackOptions({
        PST_AI_FALLBACK: "true",
        OPENROUTER_API_KEY: "sk-or-x",
      } as unknown as NodeJS.ProcessEnv).enabled,
    ).toBe(true);
    expect(resolveFallbackOptions({} as NodeJS.ProcessEnv).enabled).toBe(false);
  });
});

describe("validateFallbackAnalysis", () => {
  it("accepts a complete bilingual analysis", () => {
    expect(validateFallbackAnalysis(VALID)).toEqual(VALID);
  });

  it("rejects malformed shapes", () => {
    expect(validateFallbackAnalysis(null)).toBeNull();
    expect(validateFallbackAnalysis({ ...VALID, severity: "Epic" })).toBeNull();
    expect(validateFallbackAnalysis({ ...VALID, rootCausesZh: "not an array" })).toBeNull();
    expect(validateFallbackAnalysis({ ...VALID, confidence: 2 })).toBeNull();
  });
});

describe("buildFallbackContext", () => {
  it("caps long logs to head + tail", () => {
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`);
    const out = buildFallbackContext(lines.join("\n"));
    expect(out.length).toBeLessThanOrEqual(201);
    expect(out).toContain("… (middle omitted) …");
  });
});

describe("runFallback", () => {
  // Each test uses a DISTINCT log line so its distinct cache key can't be
  // polluted by another test's earlier cache write.
  const context = (line: string) => ({
    lines: [line],
    levels: ["ERROR"],
    components: ["PaymentBatch"],
    exceptions: [],
    httpStatuses: [],
  });

  it("parses a successful JSON analysis", async () => {
    const outcome = await runFallback(
      context("2026-08-21 10:00:00 ERROR weird thing A"),
      optionsWith(async () => chatResponse(JSON.stringify(VALID))),
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.analysis?.rootCausesZh).toEqual(["未知子系統"]);
    expect(outcome.analysis?.confidence).toBe(0.6);
  });

  it("caches identical masked input so repeats cost nothing", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return chatResponse(JSON.stringify(VALID));
    };
    const options = optionsWith(fetchImpl);
    const line = "2026-08-21 10:00:00 ERROR weird thing B";
    await runFallback(context(line), options);
    const second = await runFallback(context(line), options);
    expect(calls).toBe(1);
    expect(second.cached).toBe(true);
  });

  it("returns a graceful failure on non-2xx", async () => {
    const outcome = await runFallback(
      context("2026-08-21 10:00:00 ERROR weird thing C"),
      optionsWith(async () => new Response("nope", { status: 429 })),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/429/);
  });

  it("degrades politely when the model output is invalid", async () => {
    const outcome = await runFallback(
      context("2026-08-21 10:00:00 ERROR weird thing D"),
      optionsWith(async () => chatResponse("I cannot answer")),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/invalid/i);
  });

  it("does nothing when disabled", async () => {
    const outcome = await runFallback(
      context("2026-08-21 10:00:00 ERROR weird thing E"),
      optionsWith(async () => chatResponse(JSON.stringify(VALID)), { enabled: false }),
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("buildFallbackPrompt", () => {
  it("includes facts and gated log lines", () => {
    const prompt = buildFallbackPrompt({
      lines: ["L1 text"],
      levels: ["ERROR"],
      components: ["A"],
      exceptions: [],
      httpStatuses: [500],
    });
    expect(prompt).toContain("severity");
    expect(prompt).toContain("rootCausesZh");
    expect(prompt).toContain("L1: L1 text");
  });
});