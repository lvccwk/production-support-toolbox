import { createHash } from "node:crypto";
import { getDb } from "@/lib/database/db";
import { extractJsonBlock } from "./json";
import { forceTraditionalAnalysis } from "./zh";

/**
 * AI fallback for rule-engine misses (Hybrid Pattern).
 *
 * When the deterministic engine matches nothing, this opt-in layer asks
 * OpenRouter for a structured bilingual analysis of the SAME (already
 * masked) log context. Guards:
 *   - OFF unless PST_AI_FALLBACK=true AND an API key is configured,
 *   - results are cached per masked-input hash (repeat = zero cost),
 *   - strict JSON validation — invalid output degrades to the rule result,
 *   - never throws to the caller: failures come back as { ok: false }.
 */

export interface FallbackOptions {
  enabled: boolean;
  apiKey?: string;
  baseUrl: string;
  model?: string | null;
  timeoutMs: number;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

export function resolveFallbackOptions(env: NodeJS.ProcessEnv = process.env): FallbackOptions {
  const timeoutSeconds = Number(env.PST_OPENROUTER_TIMEOUT_S ?? 120);
  return {
    enabled:
      env.PST_AI_FALLBACK === "true" && Boolean(env.OPENROUTER_API_KEY),
    apiKey: env.OPENROUTER_API_KEY || undefined,
    baseUrl: env.PST_OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    model: env.PST_OPENROUTER_MODEL || null,
    timeoutMs:
      Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
        ? timeoutSeconds * 1000
        : 120_000,
  };
}

/** Structured bilingual analysis the LLM fills for unmatched logs. */
export interface FallbackAnalysis {
  severity: "Critical" | "High" | "Medium" | "Low" | "Informational";
  errorTypes: string[];
  rootCauses: string[];
  rootCausesZh: string[];
  immediateInvestigation: string[];
  immediateInvestigationZh: string[];
  suggestedFixes: string[];
  suggestedFixesZh: string[];
  longTermImprovements: string[];
  longTermImprovementsZh: string[];
  confidence: number;
}

/**
 * Bump whenever the prompt/schema changes so old cached analyses are
 * invalidated (e.g. v2: Simplified -> Traditional Chinese hard conversion).
 */
export const FALLBACK_PROMPT_VERSION = 2;

/**
 * Max tokens the model may generate per fallback analysis. The output is a
 * tight bilingual JSON schema — 4096 was far more than needed and made every
 * call noticeably slower; 1600 is comfortable for all ten fields.
 */
export const FALLBACK_MAX_TOKENS = 1600;

/**
 * Cap the outgoing context: first 100 + last 100 lines of the masked log,
 * with EACH LINE truncated to `maxCharsPerLine` (default 300) so one huge
 * line cannot inflate the prompt (tokens = time = cost). Truncation is
 * marked so the model knows the line was cut.
 */
export function buildFallbackContext(
  outgoingLog: string,
  maxEach = 100,
  maxCharsPerLine = 300,
): string[] {
  const lines = outgoingLog.split(/\r?\n/);
  const capLine = (line: string): string =>
    line.length <= maxCharsPerLine
      ? line
      : `${line.slice(0, maxCharsPerLine)} … (line truncated)`;
  const capped = lines.map(capLine);
  if (capped.length <= maxEach * 2) return capped;
  return [...capped.slice(0, maxEach), "… (middle omitted) …", ...capped.slice(-maxEach)];
}

const SEVERITIES = ["Critical", "High", "Medium", "Low", "Informational"] as const;

function strArray(value: unknown, maxItems: number, maxChars: number): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value.slice(0, maxItems)) {
    if (typeof item !== "string") return null;
    const cleaned = item.trim().slice(0, maxChars);
    if (cleaned) out.push(cleaned);
  }
  return out;
}

/** Strict validation of the LLM's fallback JSON. */
export function validateFallbackAnalysis(value: unknown): FallbackAnalysis | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  const severity = raw.severity;
  if (typeof severity !== "string" || !SEVERITIES.includes(severity as never)) return null;

  const errorTypes = strArray(raw.errorTypes, 6, 100);
  const rootCauses = strArray(raw.rootCauses, 8, 500);
  const rootCausesZh = strArray(raw.rootCausesZh, 8, 500);
  const immediateInvestigation = strArray(raw.immediateInvestigation, 8, 300);
  const immediateInvestigationZh = strArray(raw.immediateInvestigationZh, 8, 300);
  const suggestedFixes = strArray(raw.suggestedFixes, 8, 300);
  const suggestedFixesZh = strArray(raw.suggestedFixesZh, 8, 300);
  const longTermImprovements = strArray(raw.longTermImprovements, 6, 300);
  const longTermImprovementsZh = strArray(raw.longTermImprovementsZh, 6, 300);
  if (
    errorTypes === null ||
    rootCauses === null ||
    rootCausesZh === null ||
    immediateInvestigation === null ||
    immediateInvestigationZh === null ||
    suggestedFixes === null ||
    suggestedFixesZh === null ||
    longTermImprovements === null ||
    longTermImprovementsZh === null
  ) {
    return null;
  }

  const confidence = raw.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  if (confidence < 0 || confidence > 1) return null;

  return {
    severity: severity as FallbackAnalysis["severity"],
    errorTypes,
    rootCauses,
    rootCausesZh,
    immediateInvestigation,
    immediateInvestigationZh,
    suggestedFixes,
    suggestedFixesZh,
    longTermImprovements,
    longTermImprovementsZh,
    confidence,
  };
}

/** Grounded, redacted context sent to the model (same masking as the engine). */
export interface FallbackContext {
  /** Masked log text (head + tail, capped) sent to the model. */
  lines: string[];
  levels: string[];
  components: string[];
  exceptions: string[];
  httpStatuses: number[];
}

/** Cap the outgoing context: first 100 + last 100 lines of the masked log. */
export function buildFallbackPrompt(context: FallbackContext): string {
  return [
    "A log line from a production system did NOT match any known rule pattern.",
    "Analyse it from the provided facts + log excerpt ONLY — never invent files, lines or components that are not present.",
    "Output ONLY a JSON object with these fields (bilingual — every *Zh field in Traditional Chinese 繁體中文):",
    '{ "severity": "Critical|High|Medium|Low|Informational", "errorTypes": ["..."], "rootCauses": ["..."], "rootCausesZh": ["..."], "immediateInvestigation": ["..."], "immediateInvestigationZh": ["..."], "suggestedFixes": ["..."], "suggestedFixesZh": ["..."], "longTermImprovements": ["..."], "longTermImprovementsZh": ["..."], "confidence": 0.0-1.0 }',
    "MANDATORY: every Chinese string MUST be Traditional Chinese (繁體中文) — Simplified Chinese (简体) is FORBIDDEN. Write 問題/影響/建議/檢查/分析/服務器日誌 as 問題/影響/建議/檢查/分析/伺服器日誌, never the simplified forms 问题/影响/建议/检查/分析/服务器日志.",
    "",
    `FACTS: levels=${JSON.stringify(context.levels)} components=${JSON.stringify(context.components)} exceptions=${JSON.stringify(context.exceptions)} httpStatuses=${JSON.stringify(context.httpStatuses)}`,
    "",
    "LOG EXCERPT (1-based):",
    ...context.lines.map((line, i) => `L${i + 1}: ${line}`),
    "",
    "If the excerpt is insufficient, still give your best structured assessment and set confidence below 0.4.",
  ].join("\n");
}

export interface FallbackOutcome {
  ok: boolean;
  analysis?: FallbackAnalysis;
  cached?: boolean;
  durationMs?: number;
  model?: string | null;
  error?: string;
}

export interface FallbackCacheRow {
  result: string;
  model: string;
}

export function getFallbackCache(cacheKey: string): unknown | null {
  const row = getDb().prepare("SELECT result FROM analysis_cache WHERE cache_key = ?").get(
    cacheKey,
  ) as { result: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.result) as unknown;
  } catch {
    return null;
  }
}

export function putFallbackCache(cacheKey: string, model: string, result: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO analysis_cache (cache_key, result, model, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET result = excluded.result,
         model = excluded.model, created_at = excluded.created_at`,
    )
    .run(cacheKey, JSON.stringify(result), model, new Date().toISOString());
}

export function fallbackCacheKey(outgoingLog: string, model: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: "ai-fallback",
        promptVersion: FALLBACK_PROMPT_VERSION,
        log: outgoingLog,
        model,
      }),
    )
    .digest("hex");
}

const SYSTEM_PROMPT =
  "You are a senior production support engineer. The deterministic rule engine found no match; fill in a structured bilingual (English + Traditional Chinese 繁體中文) analysis strictly from the given facts and log excerpt. All Chinese output MUST be Traditional Chinese (繁體中文) — Simplified Chinese (简体) is FORBIDDEN. Be concise and honest about uncertainty.";

/** Run the AI fallback for one analysis context. Never throws. */
export async function runFallback(
  context: FallbackContext,
  options: FallbackOptions,
): Promise<FallbackOutcome> {
  if (!options.enabled) {
    return { ok: false, error: "AI fallback is disabled (PST_AI_FALLBACK=true + key required)." };
  }
  const { apiKey, baseUrl, model, timeoutMs, fetchImpl } = options;
  const outgoingLog = context.lines.join("\n");

  const cacheKey = fallbackCacheKey(outgoingLog, model ?? "");
  const cached = getFallbackCache(cacheKey);
  if (cached !== null) {
    const validated = validateFallbackAnalysis(cached);
    if (validated) {
      // Cache entries are stored already-converted; run the pass anyway so
      // Traditional Chinese is guaranteed no matter what is in the store.
      return { ok: true, analysis: forceTraditionalAnalysis(validated), cached: true, model };
    }
    // Stale entry: fall through and re-run.
  }

  const endpoint = `${(baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? 120_000);
  const start = Date.now();

  try {
    const response = await (fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildFallbackPrompt(context) },
        ],
        temperature: 0.2,
        max_tokens: FALLBACK_MAX_TOKENS,
      }),
      signal: controller.signal,
    });

    const bodyText = await response.text();
    if (!response.ok) {
      // NEVER forward the upstream response body to the client: it can carry
      // quota details, model names or echoed credentials. Keep only the
      // status (and the broad category) so the caller can act on it.
      const category =
        response.status >= 500 ? "provider" : response.status === 401 || response.status === 403 ? "auth" : "request";
      return {
        ok: false,
        error: `OpenRouter rejected the request (HTTP ${response.status}, ${category}).`,
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      return { ok: false, error: "OpenRouter returned invalid JSON." };
    }
    const content = pickContent(parsed);
    if (content === null) {
      return { ok: false, error: "OpenRouter returned no usable content." };
    }
    const json = extractJsonBlock(content);
    const validated = json ? validateFallbackAnalysis(json) : null;
    if (!validated) {
      return { ok: false, error: "AI fallback returned invalid analysis (schema)." };
    }
    // Hard guarantee: the model may write Simplified Chinese — convert every
    // Chinese field to Traditional (繁體) before caching/returning, so the
    // GUI, Support History and CSV/JSON exports only ever see Traditional.
    const analysis = forceTraditionalAnalysis(validated);
    putFallbackCache(cacheKey, model ?? "", analysis);
    return {
      ok: true,
      analysis,
      cached: false,
      durationMs: Date.now() - start,
      model,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      error: aborted
        ? `AI fallback timed out after ${timeoutMs}ms.`
        : `AI fallback failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Extract choices[0].message.content (string or concatenated text parts). */
function pickContent(parsed: unknown): string | null {
  if (parsed === null || typeof parsed !== "object") return null;
  const root = parsed as Record<string, unknown>;
  const choices = root.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (first === null || typeof first !== "object") return null;
  const message = (first as Record<string, unknown>).message;
  if (message === null || typeof message !== "object") return null;
  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => (part && typeof part === "object" ? (part as Record<string, unknown>).text : null))
      .filter((text): text is string => typeof text === "string" && text.length > 0);
    return parts.length > 0 ? parts.join("\n") : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Streaming fallback (Engineering follow-up: "AI 分析 LOAD 好耐").
//
// The non-streaming runFallback waits for the FULL generation before returning
// anything (tens of seconds on slow models). streamFallback pushes the model's
// tokens to the caller as they arrive (SSE via the /analyze/stream route), so
// the GUI can show live progress instead of a blank spinner. Cache semantics,
// validation, Traditional-Chinese conversion and timeout guards are identical
// to runFallback.
// ---------------------------------------------------------------------------

export interface StreamFallbackEvent {
  type: "delta" | "result" | "error";
  /** Incremental model text (type "delta"). */
  text?: string;
  /** Validated + Traditional-Chinese-converted analysis (type "result"). */
  analysis?: FallbackAnalysis;
  /** True when served from the cache (type "result"). */
  cached?: boolean;
  /** Client-safe error message (type "error"). */
  error?: string;
}

const STREAM_FINISH = "[DONE]";

/** Split one SSE block ("event:"/"data:" lines) into its parts. */
function parseSseBlock(block: string): { event?: string; data: string } | null {
  const lines = block.split(/\r?\n/);
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^\s/, ""));
    // "id:", ":comment" and blank lines are ignored.
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

async function* sseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event?: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1 || (sep = buffer.indexOf("\r\n\r\n")) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseSseBlock(block);
        if (parsed) yield parsed;
      }
    }
    if (buffer.trim()) {
      const parsed = parseSseBlock(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Extract choices[0].delta.content (or message.content) from a stream chunk. */
function extractStreamDelta(chunkText: string): string | null {
  try {
    const parsed: unknown = JSON.parse(chunkText);
    if (parsed === null || typeof parsed !== "object") return null;
    const root = parsed as Record<string, unknown>;
    const choices = root.choices;
    if (!Array.isArray(choices) || choices.length === 0) return null;
    const first = choices[0];
    if (first === null || typeof first !== "object") return null;
    const record = first as Record<string, unknown>;
    const delta = record.delta;
    if (delta !== null && typeof delta === "object") {
      const content = (delta as Record<string, unknown>).content;
      if (typeof content === "string" && content.length > 0) return content;
    }
    // Some providers echo `message` instead of `delta` in stream chunks.
    const message = record.message;
    if (message !== null && typeof message === "object") {
      const content = (message as Record<string, unknown>).content;
      if (typeof content === "string" && content.length > 0) return content;
    }
    return null;
  } catch {
    return null;
  }
}

function providerErrorCategory(status: number): string {
  if (status >= 500) return "provider";
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate-limited";
  return "request";
}

/**
 * Streaming counterpart of runFallback. Never throws: failures come back as
 * `{ type: "error" }` events. On success: `delta` events while the model
 * writes, then one `result` event with the validated, Traditional-Chinese
 * analysis (already cached). Cache hits emit `result` immediately with no
 * deltas.
 */
export async function* streamFallback(
  context: FallbackContext,
  options: FallbackOptions,
): AsyncGenerator<StreamFallbackEvent> {
  if (!options.enabled) {
    yield {
      type: "error",
      error: "AI fallback is disabled (PST_AI_FALLBACK=true + key required).",
    };
    return;
  }
  const { apiKey, baseUrl, model, timeoutMs, fetchImpl } = options;
  const outgoingLog = context.lines.join("\n");

  const cacheKey = fallbackCacheKey(outgoingLog, model ?? "");
  const cached = getFallbackCache(cacheKey);
  if (cached !== null) {
    const validated = validateFallbackAnalysis(cached);
    if (validated) {
      yield {
        type: "result",
        analysis: forceTraditionalAnalysis(validated),
        cached: true,
      };
      return;
    }
    // Stale/invalid entry: fall through and re-run.
  }

  const endpoint = `${(baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? 120_000);

  try {
    const response = await (fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildFallbackPrompt(context) },
        ],
        temperature: 0.2,
        max_tokens: FALLBACK_MAX_TOKENS,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Never forward the upstream body: only status + broad category.
      await response.body?.cancel().catch(() => undefined);
      yield {
        type: "error",
        error: `OpenRouter rejected the request (HTTP ${response.status}, ${providerErrorCategory(response.status)}).`,
      };
      return;
    }
    if (!response.body) {
      yield { type: "error", error: "OpenRouter returned no stream." };
      return;
    }

    let rawContent = "";
    for await (const chunk of sseEvents(response.body)) {
      if (chunk.data.trim() === STREAM_FINISH) break;
      const delta = extractStreamDelta(chunk.data);
      if (!delta) continue;
      rawContent += delta;
      yield { type: "delta", text: delta };
    }

    if (!rawContent.trim()) {
      yield { type: "error", error: "OpenRouter returned no usable content." };
      return;
    }

    const json = extractJsonBlock(rawContent);
    const validated = json ? validateFallbackAnalysis(json) : null;
    if (!validated) {
      yield { type: "error", error: "AI fallback returned invalid analysis (schema)." };
      return;
    }
    // Hard guarantee: convert every Chinese field to Traditional before
    // caching/returning so GUI, history and exports never see Simplified.
    const analysis = forceTraditionalAnalysis(validated);
    putFallbackCache(cacheKey, model ?? "", analysis);
    yield { type: "result", analysis, cached: false };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    yield {
      type: "error",
      error: aborted
        ? `AI fallback timed out after ${timeoutMs}ms.`
        : `AI fallback failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}