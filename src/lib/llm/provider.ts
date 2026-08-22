/**
 * LLM provider abstraction. The rest of the application talks to this
 * interface; today the only transport is the direct OpenRouter REST call
 * (see openrouter.ts). Swapping or adding another transport (e.g. a local
 * Ollama endpoint) means adding another provider class.
 */

export interface LlmAnalysisRequest {
  /** System instruction (role, output constraints). */
  system: string;
  /** User content — the grounded facts + evidence lines, already masked. */
  user: string;
  /** Optional model override (provider-dependent). */
  model?: string | null;
  /** Hard timeout in ms (default from provider options). */
  timeoutMs?: number;
}

export interface LlmProviderResult {
  provider: string;
  model: string | null;
  durationMs: number;
  /** Parsed JSON object returned by the model. */
  json: Record<string, unknown>;
}

export interface LlmProvider {
  readonly id: string;
  /** The model this provider is configured with (null when unset). */
  readonly defaultModel: string | null;
  analyze(request: LlmAnalysisRequest): Promise<LlmProviderResult>;
}