import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, initDb } from "@/lib/database/db";
import {
  buildFallbackContext,
  buildFallbackPrompt,
  fallbackCacheKey,
  FALLBACK_MAX_TOKENS,
  putFallbackCache,
  resolveFallbackOptions,
  runFallback,
  streamFallback,
  validateFallbackAnalysis,
} from "./fallback";
import type {
  FallbackAnalysis,
  FallbackOptions,
  StreamFallbackEvent,
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

  it("truncates individual oversized lines (no 500k-char prompt lines)", () => {
    const longLine = "x".repeat(20_000);
    const out = buildFallbackContext(longLine, 100, 300);
    expect(out).toHaveLength(1);
    expect(out[0]!.length).toBeLessThan(320);
    expect(out[0]).toContain("… (line truncated)");
  });

  it("keeps short lines intact", () => {
    const out = buildFallbackContext("short line\nanother");
    expect(out).toEqual(["short line", "another"]);
  });

  it("FALLBACK_MAX_TOKENS is bounded (streams finish faster)", () => {
    expect(FALLBACK_MAX_TOKENS).toBeLessThanOrEqual(1600);
    expect(FALLBACK_MAX_TOKENS).toBeGreaterThan(256);
  });
});

/** Build an SSE Response that emits the given chunks. */
function streamResponse(...chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const deltaChunk = (text: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
const DONE_CHUNK = "data: [DONE]\n\n";

describe("streamFallback (Engineering follow-up: slow AI analysis)", () => {
  // Distinct log lines per test keep cache keys isolated (same rule as runFallback).
  const context = (line: string) => ({
    lines: [line],
    levels: ["ERROR"],
    components: ["PaymentBatch"],
    exceptions: [],
    httpStatuses: [],
  });

  it("emits delta events while the model writes, then a validated result", async () => {
    // The final streamed text reassembles the FULL strict-JSON analysis.
    const full = JSON.stringify(VALID);
    const modelChunks = [
      deltaChunk(full.slice(0, 40)),
      deltaChunk(full.slice(40, 120)),
      deltaChunk(full.slice(120)),
      DONE_CHUNK,
    ];
    const options = optionsWith(async () => streamResponse(...modelChunks));
    const events: StreamFallbackEvent[] = [];
    const deltas: string[] = [];
    let result: FallbackAnalysis | null = null;
    for await (const event of streamFallback(context("2026-08-21 10:00:00 ERROR stream thing A"), options)) {
      events.push(event);
      if (event.type === "delta") deltas.push(event.text ?? "");
      if (event.type === "result") result = event.analysis ?? null;
    }
    expect(deltas.length).toBe(3);
    expect(deltas.join("")).toBe(full);
    expect(events.some((e) => e.type === "result")).toBe(true);
    expect(events.find((e) => e.type === "result")?.cached).toBe(false);
    expect(result?.rootCauses).toEqual(["unknown subsystem"]);
    expect(result?.confidence).toBe(0.6);
  });

  it("serves cache hits immediately with no deltas", async () => {
    const model = "deepseek/deepseek-v4-flash-0731";
    const line = "2026-08-21 10:00:00 ERROR stream thing B";
    putFallbackCache(fallbackCacheKey(line, model), model, VALID);
    let fetchCalled = false;
    const events: string[] = [];
    for await (const event of streamFallback(
      context(line),
      optionsWith(async () => {
        fetchCalled = true;
        return streamResponse();
      }),
    )) {
      events.push(event.type);
    }
    expect(fetchCalled).toBe(false);
    expect(events).toEqual(["result"]);
  });

  it("converts Simplified Chinese to Traditional before caching (stream path too)", async () => {
    const simplified = {
      ...VALID,
      rootCausesZh: ["问题分析建议"],
      immediateInvestigationZh: ["检查服务器日志"],
      suggestedFixesZh: ["重启服务"],
    };
    const options = optionsWith(
      async () => streamResponse(deltaChunk(JSON.stringify(simplified)), DONE_CHUNK),
    );
    let result: { type: string; analysis?: unknown; cached?: boolean } | null = null;
    for await (const event of streamFallback(
      context("2026-08-21 10:00:00 ERROR stream thing C"),
      options,
    )) {
      if (event.type === "result") result = event;
    }
    const analysis = result?.analysis as {
      rootCausesZh: string[];
      immediateInvestigationZh: string[];
      suggestedFixesZh: string[];
    };
    expect(analysis.rootCausesZh).toEqual(["問題分析建議"]);
    expect(analysis.immediateInvestigationZh).toEqual(["檢查伺服器日誌"]);
    expect(analysis.suggestedFixesZh).toEqual(["重啓服務"]);
  });

  it("reports errors as events without forwarding the upstream body", async () => {
    const events: string[] = [];
    let errorMessage = "";
    for await (const event of streamFallback(
      context("2026-08-21 10:00:00 ERROR stream thing D"),
      optionsWith(async () => new Response('{"error":{"message":"secret upstream detail"}}', { status: 429 })),
    )) {
      events.push(event.type);
      if (event.type === "error") errorMessage = event.error ?? "";
    }
    expect(events).toEqual(["error"]);
    expect(errorMessage).toContain("429");
    expect(errorMessage).not.toContain("secret upstream detail");
  });

  it("is disabled -> single error event, never throws", async () => {
    const events: string[] = [];
    for await (const event of streamFallback(
      context("2026-08-21 10:00:00 ERROR stream thing E"),
      optionsWith(async () => streamResponse(), { enabled: false }),
    )) {
      events.push(event.type);
    }
    expect(events).toEqual(["error"]);
  });

  it("rejects invalid final JSON with an error event", async () => {
    const events: string[] = [];
    let errorMessage = "";
    for await (const event of streamFallback(
      context("2026-08-21 10:00:00 ERROR stream thing F"),
      optionsWith(async () => streamResponse(deltaChunk("I cannot answer"), DONE_CHUNK)),
    )) {
      events.push(event.type);
      if (event.type === "error") errorMessage = event.error ?? "";
    }
    // The text streams first (delta), then validation fails -> error event.
    expect(events).toEqual(["delta", "error"]);
    expect(errorMessage).toMatch(/invalid|no usable/i);
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

  it("forces Traditional Chinese even when the model emits Simplified Chinese", async () => {
    const simplified = {
      ...VALID,
      rootCausesZh: ["问题分析建议"],
      immediateInvestigationZh: ["检查服务器日志"],
      suggestedFixesZh: ["重启服务"],
      longTermImprovementsZh: ["增加监控"],
    };
    const line = "2026-08-21 10:00:00 ERROR weird thing F";
    const fetchImpl = async () => chatResponse(JSON.stringify(simplified));
    const first = await runFallback(context(line), optionsWith(fetchImpl));
    expect(first.ok).toBe(true);
    expect(first.analysis?.rootCausesZh).toEqual(["問題分析建議"]);
    expect(first.analysis?.immediateInvestigationZh).toEqual(["檢查伺服器日誌"]);
    expect(first.analysis?.suggestedFixesZh).toEqual(["重啓服務"]);
    expect(first.analysis?.longTermImprovementsZh).toEqual(["增加監控"]);
    // Cache hit path returns the same converted (Traditional) analysis.
    const second = await runFallback(context(line), optionsWith(fetchImpl));
    expect(second.cached).toBe(true);
    expect(second.analysis?.rootCausesZh).toEqual(["問題分析建議"]);
    expect(second.analysis?.immediateInvestigationZh).toEqual(["檢查伺服器日誌"]);
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
    expect(prompt).toContain("繁體中文");
    expect(prompt).toContain("FORBIDDEN");
  });
});