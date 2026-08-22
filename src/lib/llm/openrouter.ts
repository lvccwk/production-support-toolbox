import { ToolError } from "@/lib/errors";
import { extractJsonBlock, tailText } from "./json";
import type { LlmAnalysisRequest, LlmProvider, LlmProviderResult } from "./provider";

/**
 * OpenRouter provider (OpenAI-compatible REST, the app's LLM transport).
 *
 * Calls `POST {baseUrl}/chat/completions` with the rule-grounded system and
 * user prompts. No CLI, no subprocess. The API key is read from
 * OPENROUTER_API_KEY in the server environment and never leaves the server.
 * Guardrails: hard timeout via AbortController, tolerant JSON extraction,
 * ToolError on any failure.
 */

export interface OpenRouterOptions {
  /** Server-side API key (OPENROUTER_API_KEY). */
  apiKey?: string;
  /** Base URL; default https://openrouter.ai/api/v1 (PST_OPENROUTER_BASE_URL). */
  baseUrl?: string;
  /** Model id, e.g. deepseek/deepseek-v4-flash-0731 (PST_OPENROUTER_MODEL). */
  model?: string | null;
  /** Hard timeout in ms. Default 120s (PST_OPENROUTER_TIMEOUT_S). */
  timeoutMs?: number;
  /** Max output tokens. Default 4096 (PST_OPENROUTER_MAX_TOKENS). */
  maxTokens?: number;
  /** Test seam: inject a custom fetch implementation. */
  fetchImpl?: typeof fetch;
}

export function resolveOpenRouterOptions(
  env: NodeJS.ProcessEnv = process.env,
): OpenRouterOptions {
  const timeoutSeconds = Number(env.PST_OPENROUTER_TIMEOUT_S ?? 180);
  const maxTokens = Number(env.PST_OPENROUTER_MAX_TOKENS ?? 4096);
  return {
    apiKey: env.OPENROUTER_API_KEY || undefined,
    baseUrl: env.PST_OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    model: env.PST_OPENROUTER_MODEL || null,
    timeoutMs: Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
      ? timeoutSeconds * 1000
      : 180_000,
    maxTokens: Number.isInteger(maxTokens) && maxTokens > 0 ? maxTokens : 4096,
  };
}

export interface PickContentResult {
  /** Concatenated text content, or null when the model produced none. */
  content: string | null;
  finishReason: string | null;
}

/**
 * Extract `choices[0].message.content` (string or array of text parts) plus
 * the finish reason from a chat-completions response.
 */
export function pickMessageContent(parsed: unknown): PickContentResult {
  if (parsed === null || typeof parsed !== "object") {
    return { content: null, finishReason: null };
  }
  const root = parsed as Record<string, unknown>;
  const choices = root.choices;
  if (!Array.isArray(choices)) return { content: null, finishReason: null };
  const first = choices[0];
  if (first === null || typeof first !== "object") {
    return { content: null, finishReason: null };
  }
  const finishReason =
    typeof first.finish_reason === "string" ? first.finish_reason : null;
  const message = (first as Record<string, unknown>).message;
  if (message === null || typeof message !== "object") {
    return { content: null, finishReason };
  }
  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") return { content, finishReason };
  // Some models return content as an array of parts: [{type:"text",text:"…"}].
  if (Array.isArray(content)) {
    const parts = content
      .filter((part): part is Record<string, unknown> =>
        part !== null && typeof part === "object")
      .map((part) => part.text)
      .filter((text): text is string => typeof text === "string" && text.length > 0);
    return { content: parts.length > 0 ? parts.join("\n") : null, finishReason };
  }
  return { content: null, finishReason };
}

export class OpenRouterProvider implements LlmProvider {
  readonly id = "openrouter";
  readonly defaultModel: string | null;
  private options: OpenRouterOptions;

  constructor(options: OpenRouterOptions = {}) {
    this.options = { ...resolveOpenRouterOptions(), ...options };
    this.defaultModel = this.options.model ?? null;
  }

  async analyze(request: LlmAnalysisRequest): Promise<LlmProviderResult> {
    const { apiKey, baseUrl, model, timeoutMs, maxTokens, fetchImpl } = this.options;
    if (!apiKey) {
      throw new ToolError(
        "OPENROUTER_API_KEY is not set. Add it to .env (server-side only).",
      );
    }
    const selectedModel = model ?? request.model ?? null;
    if (!selectedModel) {
      throw new ToolError(
        "No model configured. Set PST_OPENROUTER_MODEL, e.g. openrouter/anthropic/claude-3.5-sonnet.",
      );
    }

    const endpoint = `${(baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "")}/chat/completions`;
    const hardTimeout = timeoutMs ?? 120_000;
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), hardTimeout);

    try {
      const response = await (fetchImpl ?? fetch)(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          temperature: 0.2,
          // Reasoning models spend tokens on an internal chain of thought
          // first; a generous cap keeps the final JSON from being truncated.
          max_tokens: maxTokens ?? 4096,
        }),
        signal: controller.signal,
      });

      const bodyText = await response.text();
      if (!response.ok) {
        throw new ToolError(
          `OpenRouter HTTP ${response.status}: ${tailText(bodyText)}`,
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        throw new ToolError(`OpenRouter returned invalid JSON: ${tailText(bodyText)}`);
      }

      const { content, finishReason } = pickMessageContent(parsed);
      if (content === null) {
        // Reasoning models can consume the whole token budget on the chain
        // of thought and never emit an answer — make that diagnosable.
        const hint =
          finishReason === "length"
            ? " (finish_reason=length — the token budget ran out; raise PST_OPENROUTER_MAX_TOKENS or use a chat model)"
            : "";
        throw new ToolError(`OpenRouter returned no usable message content${hint}.`);
      }
      const json = extractJsonBlock(content);
      if (!json) {
        throw new ToolError(`OpenRouter returned no valid JSON. Output: ${tailText(content)}`);
      }

      return {
        provider: "openrouter",
        model: selectedModel,
        durationMs: Date.now() - start,
        json,
      };
    } catch (error) {
      if (error instanceof ToolError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ToolError(
          `OpenRouter request timed out after ${hardTimeout}ms (raise PST_OPENROUTER_TIMEOUT_S if the model is slow).`,
        );
      }
      throw new ToolError(
        `OpenRouter request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}