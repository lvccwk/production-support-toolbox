/**
 * Sensitive data detection (section 17). Version 1 only WARNs — no automatic
 * sanitisation is attempted.
 */

const SENSITIVE_PATTERNS: Array<{ key: string; pattern: RegExp }> = [
  { key: "password", pattern: /\bpasswords?\b/i },
  { key: "passwd", pattern: /\bpasswd\b/i },
  { key: "token", pattern: /\btokens?\b/i },
  { key: "access_token", pattern: /\baccess[ _-]?token\b/i },
  { key: "refresh_token", pattern: /\brefresh[ _-]?token\b/i },
  { key: "authorization", pattern: /\bauthorization\b/i },
  { key: "cookie", pattern: /\bcookies?\b/i },
  { key: "session", pattern: /\bsessions?\b/i },
  { key: "secret", pattern: /\bsecrets?\b/i },
  { key: "api_key", pattern: /\bapi[ _-]?key\b/i },
  { key: "client_secret", pattern: /\bclient[ _-]?secret\b/i },
  { key: "bearer", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/ },
  { key: "private_key", pattern: /\bprivate[ _-]?key\b/i },
];

/**
 * Normalised copy where `_`, `-` and camelCase boundaries become spaces so
 * that keywords inside compound identifiers (sessionId, session_id,
 * accessToken) are still detected.
 */
function normalizeIdentifierText(text: string): string {
  return text
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

export interface SensitiveDetectionResult {
  found: boolean;
  matchedKeys: string[];
  matches: Array<{ key: string; snippet: string }>;
}

/** Detect known sensitive keywords / values in free text. */
export function detectSensitiveData(text: string): SensitiveDetectionResult {
  const normalized = normalizeIdentifierText(text);
  const matches: Array<{ key: string; snippet: string }> = [];
  for (const { key, pattern } of SENSITIVE_PATTERNS) {
    let m = text.match(pattern);
    let source = text;
    if (!m && normalized !== text) {
      m = normalized.match(pattern);
      source = normalized;
    }
    if (m) {
      const start = Math.max(0, (m.index ?? 0) - 10);
      const snippet = source.slice(start, start + 60).replace(/\s+/g, " ").trim();
      matches.push({ key, snippet });
    }
  }
  // De-duplicate by key, keep the first snippet per key.
  const byKey = new Map<string, string>();
  for (const hit of matches) {
    if (!byKey.has(hit.key)) byKey.set(hit.key, hit.snippet);
  }
  const unique = [...byKey.entries()].map(([key, snippet]) => ({ key, snippet }));
  return {
    found: unique.length > 0,
    matchedKeys: unique.map((m) => m.key),
    matches: unique,
  };
}