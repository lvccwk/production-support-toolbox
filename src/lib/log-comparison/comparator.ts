import type { Severity } from "@/types";
import { SEVERITY_ORDER } from "@/types";
import { extractLogInfo } from "@/lib/log-parser/parser";
import { analyzeLog } from "@/lib/rules/engine";
import { normalizeLog, normalizeLine } from "./normalize";
import { ToolError } from "@/lib/errors";

/**
 * Log comparison (section 7, Phase 1 de-noised): compare a "before" and an
 * "after" log and highlight new errors, missing errors, changed HTTP codes,
 * exception types, components and messages.
 *
 * De-noising: both sides are token-masked (timestamps → [TS], ids → [ID],
 * ip/url/numbers → placeholders) BEFORE the LCS diff, so lines that only
 * differ in run-specific values are not reported as changes. Error-like
 * lines are additionally clustered by (exception type + source file) so the
 * report shows "new error kinds" instead of raw line floods.
 */

const ERROR_LIKE_LINE_RE =
  /(?:Exception|Error|FATAL|ERROR|timeout|failed|refused|denied|status\s*[=:]\s*[45]\d\d|HTTP[/\s]+[45]\d\d)/i;

const MAX_REPORTED_LINES = 30;
const MAX_CLUSTERS = 10;

export interface ComparisonResult {
  newErrors: string[];
  missingErrors: string[];
  changedHttpStatuses: Array<{ before: number | null; after: number | null }>;
  changedExceptionTypes: string[];
  changedComponents: string[];
  /** Error-like lines added, normalised-diff based (noise-filtered). */
  addedLines: string[];
  removedLines: string[];
  /** Error kinds (exception + source file) new in / gone from the "after" log. */
  errorClusters: {
    added: ErrorClusterChange[];
    removed: ErrorClusterChange[];
  };
  severityBefore: Severity;
  severityAfter: Severity;
  regression: boolean;
  summary: string;
}

/** A group of error-like lines sharing the same signature. */
export interface ErrorClusterChange {
  /** Signature, e.g. `NullPointerException@PaymentService.java`. */
  key: string;
  /** Number of lines in this group (on the side where it was seen). */
  count: number;
  /** First raw line of the group, as evidence. */
  sample: string;
}

function setDiff(before: string[], after: string[]): {
  added: string[];
  removed: string[];
} {
  const b = new Set(before);
  const a = new Set(after);
  return {
    added: [...a].filter((x) => !b.has(x)),
    removed: [...b].filter((x) => !a.has(x)),
  };
}

/**
 * Classic LCS line diff over the NORMALISED lines. Returns the raw line texts
 * of the added/removed lines (both may contain repeats, mirroring the input).
 */
export function diffLines(
  before: string,
  after: string,
): { added: string[]; removed: string[] } {
  const beforeNorm = normalizeLog(before);
  const afterNorm = normalizeLog(after);
  const beforeRaw = before.split(/\r?\n/);
  const afterRaw = after.split(/\r?\n/);
  const n = beforeNorm.length;
  const m = afterNorm.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        beforeNorm[i] === afterNorm[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const added: string[] = [];
  const removed: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (beforeNorm[i] === afterNorm[j]) {
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      removed.push(beforeRaw[i].trim());
      i += 1;
    } else {
      added.push(afterRaw[j].trim());
      j += 1;
    }
  }
  for (; i < n; i++) removed.push(beforeRaw[i].trim());
  for (; j < m; j++) added.push(afterRaw[j].trim());
  return { added, removed };
}

/**
 * Cluster signature for an error(-like) line: `ExceptionType@SourceFile`, or
 * a `msg:` fallback built from the normalised line when neither is present.
 */
function errorSignature(slice: string): string {
  const info = extractLogInfo(slice);
  const exception = info.exceptions[0] ?? null;
  const file = info.sources[0]?.file ?? null;
  if (exception && file) return `${exception}@${file}`;
  if (exception) return `${exception}@?`;
  if (file) return `error@${file}`;
  return `msg:${normalizeLine(slice).slice(0, 100)}`;
}

/**
 * When clustering, attach the following stack frame line (`at ...` / `File "…`)
 * to an error line so the exception and its source file land in one signature.
 */
function errorLineSlice(lines: string[], i: number): string {
  const next = lines[i + 1];
  if (next && /^\s*(?:at\s|File\s")/.test(next)) {
    return `${lines[i]}\n${next}`;
  }
  return lines[i];
}

/** Group error-like lines by signature; kept capped and count-desc sorted. */
function clusterErrorLines(lines: string[]): ErrorClusterChange[] {
  const groups = new Map<string, ErrorClusterChange>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || !ERROR_LIKE_LINE_RE.test(line)) continue;
    const key = errorSignature(errorLineSlice(lines, i));
    const group = groups.get(key);
    if (group) {
      group.count += 1;
    } else {
      groups.set(key, { key, count: 1, sample: line });
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, MAX_CLUSTERS);
}

function pairStatusChanges(
  before: number[],
  after: number[],
): Array<{ before: number | null; after: number | null }> {
  const changes: Array<{ before: number | null; after: number | null }> = [];
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const gone = before.filter((c) => !afterSet.has(c));
  const novel = after.filter((c) => !beforeSet.has(c));
  const pairCount = Math.max(gone.length, novel.length);
  for (let k = 0; k < pairCount; k++) {
    changes.push({
      before: gone[k] ?? null,
      after: novel[k] ?? null,
    });
  }
  return changes;
}

export interface ComparisonInput {
  before: string;
  after: string;
}

/** Compare two raw logs. Throws ToolError when either side is empty. */
export function compareLogs(before: string, after: string): ComparisonResult {
  if (!before.trim()) throw new ToolError("Please paste the 'before' log.");
  if (!after.trim()) throw new ToolError("Please paste the 'after' log.");

  const beforeInfo = extractLogInfo(before);
  const afterInfo = extractLogInfo(after);
  const beforeAnalysis = analyzeLog(before, beforeInfo);
  const afterAnalysis = analyzeLog(after, afterInfo);

  const errorsDiff = setDiff(beforeInfo.exceptions, afterInfo.exceptions);
  const typeDiff = setDiff(beforeAnalysis.errorTypes, afterAnalysis.errorTypes);
  const componentDiff = setDiff(beforeInfo.components, afterInfo.components);
  const httpChanges = pairStatusChanges(
    beforeInfo.httpStatuses,
    afterInfo.httpStatuses,
  );

  // Noise-filtered diff: added/removed raw lines whose NORMALISED versions
  // differ, restricted to error-like lines.
  const { added, removed } = diffLines(before, after);
  const addedErrorLines = added.filter((line) => ERROR_LIKE_LINE_RE.test(line));
  const removedErrorLines = removed.filter((line) =>
    ERROR_LIKE_LINE_RE.test(line),
  );

  // Error-kind clustering on the raw error-like lines of each side.
  const beforeClusters = clusterErrorLines(before.split(/\r?\n/));
  const afterClusters = clusterErrorLines(after.split(/\r?\n/));
  const beforeKeys = new Set(beforeClusters.map((c) => c.key));
  const afterKeys = new Set(afterClusters.map((c) => c.key));
  const clusterAdded = afterClusters
    .filter((c) => !beforeKeys.has(c.key))
    .slice(0, MAX_CLUSTERS);
  const clusterRemoved = beforeClusters
    .filter((c) => !afterKeys.has(c.key))
    .slice(0, MAX_CLUSTERS);

  const newErrors = [...new Set([...errorsDiff.added, ...typeDiff.added])];
  const missingErrors = [...new Set([...errorsDiff.removed, ...typeDiff.removed])];

  const severityBefore = beforeAnalysis.severity;
  const severityAfter = afterAnalysis.severity;

  const hasNewBadHttp = httpChanges.some((c) => c.after !== null && c.after >= 400);
  const severityWorsened =
    SEVERITY_ORDER[severityAfter] > SEVERITY_ORDER[severityBefore];
  // Regression verdict is driven by NEW ERROR KINDS (clusters), bad HTTP
  // changes or severity worsening — not by raw line counts.
  const regression =
    clusterAdded.length > 0 || hasNewBadHttp || severityWorsened;

  const summary = regression
    ? "Regression detected."
    : "No regression detected.";

  return {
    newErrors,
    missingErrors,
    changedHttpStatuses: httpChanges,
    changedExceptionTypes: typeDiff.added,
    changedComponents: componentDiff.added,
    addedLines: addedErrorLines.slice(0, MAX_REPORTED_LINES),
    removedLines: removedErrorLines.slice(0, MAX_REPORTED_LINES),
    errorClusters: { added: clusterAdded, removed: clusterRemoved },
    severityBefore,
    severityAfter,
    regression,
    summary,
  };
}

/** Convenience overload accepting a single object. */
export function compareLogsInput(input: ComparisonInput): ComparisonResult {
  return compareLogs(input.before, input.after);
}