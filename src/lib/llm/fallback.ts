import { createHash } from "node:crypto";
import { getDb } from "@/lib/database/db";
import { extractJsonBlock, tailText } from "./json";
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
export function buildFallbackContext(outgoingLog: string, maxEach = 100): string[] {
  const lines = outgoingLog.split(/\r?\n/);
  if (lines.length <= maxEach * 2) return lines;
  return [...lines.slice(0, maxEach), "… (middle omitted) …", ...lines.slice(-maxEach)];
}

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
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });

    const bodyText = await response.text();
    if (!response.ok) {
      return { ok: false, error: `OpenRouter HTTP ${response.status}: ${tailText(bodyText)}` };
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