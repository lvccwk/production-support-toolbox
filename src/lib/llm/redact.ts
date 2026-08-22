/**
 * Privacy guard: redacts sensitive VALUES before anything leaves the machine
 * (Phase 3, section 7.2). The log text is masked in place:
 *   `password=abc123`              -> `password=[REDACTED:password]`
 *   `Authorization: Bearer xyz...` -> `Authorization: [REDACTED:authorization]`
 * Word-only mentions (no value) are left untouched — the UI still warns via
 * the sensitive-data detector before sending.
 */

const SECRET_KEY_WORDS =
  "password|passwd|pwd|secret|token|access[\\s_-]?token|refresh[\\s_-]?token|" +
  "api[\\s_-]?key|client[\\s_-]?secret|private[\\s_-]?key|authorization|credential";

/** `key=value` / `key: value` forms (quotes excluded from the captured value). */
const KEY_VALUE_RE = new RegExp(
  `\\b(${SECRET_KEY_WORDS})\\b[^=:;\\n]{0,20}[=:]\\s*["']?([^\\s"',;]+)["']?`,
  "gi",
);

/** `Bearer <base64ish>` / `Basic <base64ish>` header values. */
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

export interface RedactResult {
  text: string;
  /** Unique keys whose values were masked (sorted). */
  maskedKeys: string[];
}

/** True when the text still mentions any sensitive keyword (for UI warnings). */
export function hasSensitiveWordMentions(text: string): boolean {
  const REMAINING_RE = new RegExp(`\\b(${SECRET_KEY_WORDS})\\b`, "gi");
  return REMAINING_RE.test(text);
}

/**
 * Replace sensitive values with [REDACTED:key] placeholders. Idempotent:
 * redacting an already-redacted text is a no-op.
 */
export function redactSensitiveValues(text: string): RedactResult {
  const maskedKeys = new Set<string>();

  // Pass 1: header-style tokens first, reduced to a placeholder so a bare
  // Bearer token cannot slip through as the value of an `authorization:` key.
  let out = text.replace(BEARER_RE, () => {
    maskedKeys.add("authorization");
    return "[REDACTED:authorization]";
  });

  // Pass 2: key=value / key: value forms.
  out = out.replace(KEY_VALUE_RE, (match, key: string, value: string) => {
    maskedKeys.add(key.trim().toLowerCase());
    return match.replace(value, `[REDACTED:${key.trim().toLowerCase()}]`);
  });

  return { text: out, maskedKeys: [...maskedKeys].sort() };
}