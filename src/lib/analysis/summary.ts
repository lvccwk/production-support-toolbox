import { RULES } from "@/lib/rules/rules";
import { firstLineTimestamp, lineLevel } from "@/lib/log-parser/parser";
import type { ErrorType, LogRule } from "@/types";

/**
 * Quantitative log summary (feature ①): turns the rule engine's line-level
 * hits into an aggregate picture an agent can act on instantly:
 *   - error-type frequency ranking,
 *   - per-rule hit counts (UNCAPPED — the UI engine caps evidence at 8
 *     lines/rule for display),
 *   - level distribution (ERROR/WARN/INFO/...),
 *   - per-minute time distribution of flagged lines (spike detection),
 *   - approximate top components (token right after the level).
 *
 * Pure, local, deterministic — no LLM.
 */

const RULE_TYPE: Record<string, ErrorType> = Object.fromEntries(
  RULES.map((rule) => [rule.id, rule.errorType]),
);

const LEVEL_ORDER = ["FATAL", "ERROR", "WARN", "INFO", "DEBUG", "TRACE", "OTHER"];
const COMPONENT_AFTER_LEVEL_RE = /\b(?:TRACE|DEBUG|INFO|NOTICE|WARNING|WARN|ERROR|SEVERE|FATAL|CRITICAL)\b\s+([A-Za-z][A-Za-z0-9_.\-]*)/;

export interface SummaryCount<T extends string = string> {
  key: T;
  hits: number;
}

export interface TimeBucket {
  /** "yyyy-MM-dd HH:mm" of the first matching minute window. */
  minute: string;
  /** Flagged (rule-matched) lines in this minute. */
  flagged: number;
  /** Error-like level lines (ERROR/FATAL/SEVERE/CRITICAL) in this minute. */
  errors: number;
}

export interface LogSummary {
  totalLines: number;
  /** Distinct lines matched by at least one rule. */
  flaggedLines: number;
  /** Highest-frequency error types first. */
  topErrorTypes: Array<{ type: ErrorType; hits: number }>;
  /** Per-rule hit counts (uncapped). */
  ruleHits: Array<{ ruleId: string; hits: number }>;
  /** Level distribution across all lines. */
  levelCounts: SummaryCount[];
  /** Per-minute windows containing flagged or error lines, oldest first. */
  timeDistribution: TimeBucket[];
  /** Approximate component counts (token right after the level). */
  topComponents: SummaryCount[];
}

const ERROR_LEVEL_RE = /\b(ERROR|FATAL|SEVERE|CRITICAL)\b/i;

/** Minute bucket label from a line timestamp like "2026-08-21 10:15:22". */
function toMinute(timestamp: string | null): string | null {
  if (!timestamp) return null;
  const m = timestamp.match(/^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})/);
  return m ? m[1].replace("T", " ") : null;
}

export function buildLogSummary(text: string, extraRules: LogRule[] = []): LogSummary {
  const lines = text.split(/\r?\n/);
  const rules = [...RULES, ...extraRules];

  // --- one uncapped pass over rules (built-in + custom) -------------------
  const ruleHits: Record<string, number> = {};
  const typeHits = new Map<ErrorType, number>();
  const flaggedLines = new Set<number>();

  for (const rule of rules) {
    let hits = 0;
    for (let i = 0; i < lines.length; i++) {
      if (rule.patterns.some((pattern) => pattern.test(lines[i]))) {
        hits += 1;
        flaggedLines.add(i + 1);
      }
    }
    if (hits > 0) {
      ruleHits[rule.id] = hits;
      const type: ErrorType = RULE_TYPE[rule.id] ?? "Custom Error";
      typeHits.set(type, (typeHits.get(type) ?? 0) + hits);
    }
  }

  // --- level + time + component aggregation ---------------------------
  const levelCounts = new Map<string, number>();
  const timeBuckets = new Map<string, TimeBucket>();
  const componentCounts = new Map<string, number>();

  lines.forEach((line, index) => {
    const level = lineLevel(line);
    if (level) {
      levelCounts.set(level, (levelCounts.get(level) ?? 0) + 1);
    }
    const isErrorLine = ERROR_LEVEL_RE.test(line);
    const isFlagged = flaggedLines.has(index + 1);
    if (!isErrorLine && !isFlagged) return; // only bucket meaningful lines

    const minute = toMinute(firstLineTimestamp(line));
    const key = minute ?? "no-timestamp";
    const bucket = timeBuckets.get(key) ?? { minute: key, flagged: 0, errors: 0 };
    if (isFlagged) bucket.flagged += 1;
    if (isErrorLine) bucket.errors += 1;
    timeBuckets.set(key, bucket);

    const comp = line.match(COMPONENT_AFTER_LEVEL_RE)?.[1];
    if (comp) {
      componentCounts.set(comp, (componentCounts.get(comp) ?? 0) + 1);
    }
  });

  const sortCounts = <T extends string>(map: Map<T, number>, top: number, order?: string[]) =>
    [...map.entries()]
      .sort((a, b) => {
        const rankA = order?.indexOf(a[0]) ?? -1;
        const rankB = order?.indexOf(b[0]) ?? -1;
        if (rankA >= 0 && rankB >= 0 && rankA !== rankB) return rankA - rankB;
        return b[1] - a[1];
      })
      .slice(0, top)
      .map(([key, hits]) => ({ key, hits } as { key: T; hits: number }));

  return {
    totalLines: lines.length,
    flaggedLines: flaggedLines.size,
    topErrorTypes: [...typeHits.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([type, hits]) => ({ type, hits })),
    ruleHits: Object.entries(ruleHits)
      .sort((a, b) => b[1] - a[1])
      .map(([ruleId, hits]) => ({ ruleId, hits })),
    levelCounts: sortCounts(levelCounts, 8, LEVEL_ORDER),
    timeDistribution: [...timeBuckets.values()]
      .sort((a, b) => (a.minute < b.minute ? -1 : a.minute > b.minute ? 1 : 0))
      .slice(0, 200),
    topComponents: sortCounts(componentCounts, 8),
  };
}