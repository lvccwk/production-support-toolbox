/**
 * Small LLM output parsing helpers (AI fallback transport).
 */

/** Extract a JSON object from model output (plain / fenced / balanced block). */
export function extractJsonBlock(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  const isObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isObject(parsed)) return parsed;
  } catch {
    /* fall through */
  }

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      const parsed: unknown = JSON.parse(fence[1].trim());
      if (isObject(parsed)) return parsed;
    } catch {
      /* fall through */
    }
  }

  const open = trimmed.indexOf("{");
  const close = trimmed.lastIndexOf("}");
  if (open >= 0 && close > open) {
    try {
      const parsed: unknown = JSON.parse(trimmed.slice(open, close + 1));
      if (isObject(parsed)) return parsed;
    } catch {
      /* fall through */
    }
  }
  return null;
}

/** Tail of a text, used to keep error messages short. */
export function tailText(text: string, max = 300): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `…${trimmed.slice(-max)}` : trimmed;
}