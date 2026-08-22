import { describe, expect, it } from "vitest";
import {
  OpenRouterProvider,
  pickMessageContent,
  resolveOpenRouterOptions,
} from "./openrouter";
import type { LlmAnalysisRequest } from "./provider";
import { ToolError } from "@/lib/errors";

/**
 * The direct-OpenRouter transport is exercised with a faked fetch; no real
 * network access or API key is needed.
 */

function request(overrides: Partial<LlmAnalysisRequest> = {}): LlmAnalysisRequest {
  return {
    system: "You are a support engineer.",
    user: "Analyse this.",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Build a chat-completions response body around a model message. */
function chatBody(content: string): Record<string, unknown> {
  return { choices: [{ message: { role: "assistant", content } }] };
}

function providerWith(fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) {
  return new OpenRouterProvider({
    apiKey: "sk-or-test",
    model: "openrouter/anthropic/claude-3.5-sonnet",
    timeoutMs: 1000,
    fetchImpl,
    ...overrides,
  });
}

describe("resolveOpenRouterOptions", () => {
  it("reads OpenRouter env vars", () => {
    const options = resolveOpenRouterOptions({
      OPENROUTER_API_KEY: "sk-or-x",
      PST_OPENROUTER_MODEL: "deepseek/deepseek-v4-flash-0731",
      PST_OPENROUTER_TIMEOUT_S: "30",
      PST_OPENROUTER_MAX_TOKENS: "8192",
    } as unknown as NodeJS.ProcessEnv);
    expect(options.apiKey).toBe("sk-or-x");
    expect(options.model).toBe("deepseek/deepseek-v4-flash-0731");
    expect(options.timeoutMs).toBe(30_000);
    expect(options.maxTokens).toBe(8192);
  });

  it("applies safe defaults", () => {
    const options = resolveOpenRouterOptions({} as unknown as NodeJS.ProcessEnv);
    expect(options.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(options.timeoutMs).toBe(180_000);
    expect(options.maxTokens).toBe(4096);
    expect(options.apiKey).toBeUndefined();
  });
});

describe("pickMessageContent", () => {
  it("extracts choices[0].message.content as a string", () => {
    expect(pickMessageContent(chatBody("hello")).content).toBe("hello");
  });

  it("concatenates array-of-parts content (OpenAI multimodal style)", () => {
    const body = {
      choices: [
        {
          message: {
            content: [
              { type: "text", text: "part one" },
              { type: "text", text: "part two" },
            ],
          },
        },
      ],
    };
    expect(pickMessageContent(body)).toEqual({
      content: "part one\npart two",
      finishReason: null,
    });
  });

  it("reports the finish reason and null content when truncated", () => {
    const body = {
      choices: [{ finish_reason: "length", message: { content: null, reasoning: "…" } }],
    };
    expect(pickMessageContent(body)).toEqual({
      content: null,
      finishReason: "length",
    });
  });

  it("returns nulls for malformed shapes", () => {
    expect(pickMessageContent(null)).toEqual({ content: null, finishReason: null });
    expect(pickMessageContent({})).toEqual({ content: null, finishReason: null });
    expect(pickMessageContent({ choices: [] })).toEqual({ content: null, finishReason: null });
    expect(pickMessageContent({ choices: [{ message: {} }] })).toEqual({ content: null, finishReason: null });
    expect(pickMessageContent({ choices: [{ message: { content: 42 } }] })).toEqual({ content: null, finishReason: null });
  });
});

describe("OpenRouterProvider", () => {
  it("parses a successful JSON analysis", async () => {
    const fetchImpl = async () =>
      jsonResponse(chatBody('{"severity":"High","rootCause":"stub","evidenceLines":[2]}'));
    const result = await providerWith(fetchImpl).analyze(request());
    expect(result.provider).toBe("openrouter");
    expect(result.model).toBe("openrouter/anthropic/claude-3.5-sonnet");
    expect(result.json).toEqual({
      severity: "High",
      rootCause: "stub",
      evidenceLines: [2],
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("parses a fenced ```json block inside prose", async () => {
    const fetchImpl = async () =>
      jsonResponse(chatBody('Sure:\n```json\n{"a":1}\n```\nDone.'));
    const result = await providerWith(fetchImpl).analyze(request());
    expect(result.json).toEqual({ a: 1 });
  });

  it("rejects non-2xx responses with a body tail", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 });
    await expect(providerWith(fetchImpl).analyze(request())).rejects.toThrowError(
      /OpenRouter HTTP 429:.*rate limited/,
    );
  });

  it("rejects when the model returns no usable content", async () => {
    const fetchImpl = async () => jsonResponse({ choices: [] });
    await expect(providerWith(fetchImpl).analyze(request())).rejects.toThrowError(
      /no usable message content/,
    );
  });

  it("adds a token-budget hint when finish_reason is length", async () => {
    const fetchImpl = async () =>
      jsonResponse({
        choices: [
          { finish_reason: "length", message: { content: null, reasoning: "thinking…" } },
        ],
      });
    await expect(providerWith(fetchImpl).analyze(request())).rejects.toThrowError(
      /token budget ran out/,
    );
  });

  it("rejects when the content is not JSON", async () => {
    const fetchImpl = async () => jsonResponse(chatBody("I am not json"));
    await expect(providerWith(fetchImpl).analyze(request())).rejects.toThrowError(
      /no valid JSON/,
    );
  });

  it("rejects when the API key is missing", async () => {
    const provider = new OpenRouterProvider({ model: "m", fetchImpl: async () => new Response("") });
    await expect(provider.analyze(request())).rejects.toThrowError(/OPENROUTER_API_KEY/);
  });

  it("rejects when no model is configured", async () => {
    const provider = new OpenRouterProvider({ apiKey: "sk-or-x", fetchImpl: async () => new Response("") });
    await expect(provider.analyze(request())).rejects.toThrowError(/model/i);
  });

  it("times out via AbortController", async () => {
    const fetchImpl = (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    await expect(
      providerWith(fetchImpl, { timeoutMs: 150 }).analyze(request()),
    ).rejects.toThrowError(/timed out/);
  });

  it("wraps network failures as ToolError", async () => {
    const fetchImpl = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(providerWith(fetchImpl).analyze(request())).rejects.toThrowError(
      ToolError,
    );
  });
});