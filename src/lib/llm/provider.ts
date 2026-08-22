/**
 * LLM provider abstraction (Phase 3). The rest of the application talks to
 * this interface; swapping the transport (OpenCode CLI today, a direct
 * OpenAI-compatible HTTP client tomorrow) means adding another provider.
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
  /** Extra environment variables for the provider process. */
  env?: Record<string, string>;
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
  analyze(request: LlmAnalysisRequest): Promise<LlmProviderResult>;
}