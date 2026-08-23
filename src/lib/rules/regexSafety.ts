import { ToolError } from "@/lib/errors";

/**
 * Static ReDoS screening for custom-rule patterns (Engineering Review §4).
 *
 * `new RegExp()` only checks SYNTAX; a syntactically valid pattern can still
 * be catastrophic (exponential backtracking) and block the Node event loop.
 * This module runs a small deterministic scanner over the pattern source and
 * rejects the shapes that are *known* to be dangerous:
 *
 *   1. backreferences (`\1`..`\9`, `\k<name>`) — banned outright,
 *   2. a group that contains an unbounded quantifier and is itself quantified
 *      with `*`, `+`, `?` or an unbounded `{m,}` — the classic `(a+)+` trap,
 *   3. a quantified group whose alternatives share a first character —
 *      the `(a|aa)+$` backtracking trap.
 *
 * This is a CONSERVATIVE heuristic: it may reject an unusual pattern even
 * when it is actually safe (a small set of genuinely dangerous structures is
 * banned to keep the engine predictable). Patterns that pass here are still
 * empirically verified with a time-bounded torture test before storage (see
 * torture.ts), so a surviving pattern is both statically sane AND proven to
 * finish on adversarial inputs within a hard budget.
 */

export interface PatternSafety {
  ok: boolean;
  reason?: string;
}

interface GroupFrame {
  /** A quantifier appears somewhere inside this group (transitively). */
  hasQuantifier: boolean;
  /** True when the group contains `|` at the top level. */
  hasAlternation: boolean;
  /** First literal character collected per alternative (approximation). */
  alternativesFirstChars: string[];
  /** First literal char of the alternative currently being scanned. */
  currentFirstChar: string | null;
  /** Got at least one plain atom in the current alternative. */
  sawAtom: boolean;
}

/**
 * Unbounded (or loosely bounded) outer repetition is what enables nesting:
 * `*`, `+`, `?`, `{m,}` and `{m,n}` with an effectively large n.
 * An exact `{m}` bound means the outer loop cannot explode.
 */
function outerIsUnbounded(quantifier: string): boolean {
  if (quantifier === "*" || quantifier === "+" || quantifier === "?") return true;
  const match = /^\{(\d+)(?:,(\d*))?\}$/.exec(quantifier);
  if (!match) return false;
  const hasComma = match[2] !== undefined;
  if (!hasComma) return false; // {m} exact bound — safe outer loop
  if (match[2] === "") return true; // {m,} unbounded
  return Number(match[2]) > 20;
}

/**
 * Scan a pattern source for known-dangerous structures.
 * Assumes the source already compiled (`new RegExp` check happened first).
 */
export function inspectPattern(source: string): PatternSafety {
  const frames: GroupFrame[] = [];
  let prevAtom: "char" | "group" | null = null;
  /** Data of the most recently closed group (needed by a following quantifier). */
  let closedGroup: GroupFrame | null = null;

  const frame = (): GroupFrame | null => (frames.length > 0 ? frames[frames.length - 1] : null);

  const recordAtom = (firstChar: string) => {
    const f = frame();
    if (f) {
      f.sawAtom = true;
      // Capture the first literal char of the current alternative (used for
      // the quantified-alternation check). Groups/classes are unknown -> "?".
      if (f.currentFirstChar === null) {
        f.currentFirstChar = firstChar;
      }
    }
  };

  const recordQuantifier = (quantifier: string): PatternSafety | null => {
    const f = frame();
    if (f) f.hasQuantifier = true;
    if (prevAtom === "group" && closedGroup) {
      // Rule 2: nested-quantifier trap, e.g. (a+)+, (\w+)*
      if (closedGroup.hasQuantifier && outerIsUnbounded(quantifier)) {
        return {
          ok: false,
          reason:
            "Pattern contains a quantified group that itself contains a quantifier (e.g. `(a+)+`), which can cause catastrophic backtracking.",
        };
      }
      // Rule 3: ambiguous alternation, e.g. (a|aa)+$
      if (closedGroup.hasAlternation && outerIsUnbounded(quantifier)) {
        const counts = new Map<string, number>();
        for (const first of closedGroup.alternativesFirstChars) {
          if (first === "?") continue; // unknown first char — skip
          counts.set(first, (counts.get(first) ?? 0) + 1);
        }
        for (const count of counts.values()) {
          if (count > 1) {
            return {
              ok: false,
              reason:
                "Pattern contains a quantified alternation whose branches can match the same prefix (e.g. `(a|aa)+`), which can cause catastrophic backtracking.",
            };
          }
        }
      }
    }
    prevAtom = null;
    closedGroup = null;
    return null;
  };

  let i = 0;
  while (i < source.length) {
    const ch = source[i];

    if (ch === "\\") {
      const next = source[i + 1] ?? "";
      if (/[1-9]/.test(next)) {
        return { ok: false, reason: "Backreferences (\\1…\\9) are not allowed in custom patterns." };
      }
      if (next === "k" && source[i + 2] === "<") {
        return { ok: false, reason: "Named backreferences (\\k<name>) are not allowed in custom patterns." };
      }
      recordAtom("?");
      prevAtom = "char";
      i += 2;
      continue;
    }

    if (ch === "[") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === "]") break;
        j += 1;
      }
      recordAtom("?");
      prevAtom = "char";
      i = Math.min(j + 1, source.length);
      continue;
    }

    if (ch === "(") {
      frames.push({
        hasQuantifier: false,
        hasAlternation: false,
        alternativesFirstChars: [],
        currentFirstChar: null,
        sawAtom: false,
      });
      prevAtom = "group";
      closedGroup = null;
      i += 1;
      continue;
    }

    if (ch === ")") {
      const popped = frames.pop();
      if (popped) {
        if (popped.sawAtom && popped.currentFirstChar !== null) {
          popped.alternativesFirstChars.push(popped.currentFirstChar);
        }
        closedGroup = popped;
        const parent = frame();
        if (parent && popped.hasQuantifier) {
          parent.hasQuantifier = true;
        }
        prevAtom = "group";
        // A group boundary also ends the current alternative's first-char capture.
        if (parent) {
          recordAtom("?");
        }
      } else {
        prevAtom = "char";
      }
      i += 1;
      continue;
    }

    if (ch === "|") {
      const f = frame();
      if (f) {
        f.hasAlternation = true;
        if (f.sawAtom && f.currentFirstChar !== null) {
          f.alternativesFirstChars.push(f.currentFirstChar);
        }
        f.currentFirstChar = null;
        f.sawAtom = false;
      }
      prevAtom = null;
      i += 1;
      continue;
    }

    if (ch === "*" || ch === "+" || ch === "?") {
      const violation = recordQuantifier(ch);
      if (violation) return violation;
      i += 1;
      continue;
    }

    if (ch === "{") {
      const match = /^\{(\d+)(?:,(\d*))?\}/.exec(source.slice(i));
      if (match) {
        const violation = recordQuantifier(match[0]);
        if (violation) return violation;
        i += match[0].length;
        continue;
      }
      // Not a quantifier — treat as a plain literal char.
      recordAtom(ch);
      prevAtom = "char";
      i += 1;
      continue;
    }

    // Plain literal (including . ^ $ and friends).
    recordAtom(ch);
    prevAtom = "char";
    i += 1;
  }

  return { ok: true };
}

/**
 * Validate a pattern list: syntax first, then static ReDoS screening.
 * Throws ToolError with the offending index, mirroring the current semantic
 * of validateCustomRuleInput.
 */
export function assertPatternsSafe(patterns: string[]): void {
  patterns.forEach((pattern, index) => {
    try {
      new RegExp(pattern);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "invalid regex";
      throw new ToolError(`Invalid pattern #${index + 1}: ${reason.slice(0, 120)}`);
    }
    const safety = inspectPattern(pattern);
    if (!safety.ok) {
      throw new ToolError(`Unsafe pattern #${index + 1}: ${safety.reason}`);
    }
  });
}