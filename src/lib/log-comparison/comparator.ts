import type { Severity } from "@/types";
import { SEVERITY_ORDER } from "@/types";
import { extractLogInfo } from "@/lib/log-parser/parser";
import { analyzeLog } from "@/lib/rules/engine";
import { ToolError } from "@/lib/errors";

/**
 * Log comparison (section 7): compare a "before" and an "after" log and
 * highlight new errors, missing errors, changed HTTP codes, exception types,
 * components and messages.
 */

const ERROR_LIKE_LINE_RE =
  /(?:Exception|Error|FATAL|ERROR|timeout|failed|refused|denied|status\s*[=:]\s*[45]\d\d|HTTP[/\s]+[45]\d\d)/i;

export interface ComparisonResult {
  newErrors: string[];
  missingErrors: string[];
  changedHttpStatuses: Array<{ before: number | null; after: number | null }>;
  changedExceptionTypes: string[];
  changedComponents: string[];
  addedLines: string[];
  removedLines: string[];
  severityBefore: Severity;
  severityAfter: Severity;
  regression: boolean;
  summary: string;
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

/** Classic LCS line diff — returns added and removed unique lines. */
export function diffLines(before: string, after: string): { added: string[]; removed: string[] } {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const n = beforeLines.length;
  const m = afterLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        beforeLines[i] === afterLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const added: string[] = [];
  const removed: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (beforeLines[i] === afterLines[j]) {
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      removed.push(beforeLines[i]);
      i += 1;
    } else {
      added.push(afterLines[j]);
      j += 1;
    }
  }
  for (; i < n; i++) removed.push(beforeLines[i]);
  for (; j < m; j++) added.push(afterLines[j]);
  return { added, removed };
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
  const httpChanges = pairStatusChanges(beforeInfo.httpStatuses, afterInfo.httpStatuses);
  const { added, removed } = diffLines(before, after);

  const addedErrorLines = added.filter((line) => ERROR_LIKE_LINE_RE.test(line));
  const removedErrorLines = removed.filter((line) => ERROR_LIKE_LINE_RE.test(line));

  const newErrors = [...new Set([...errorsDiff.added, ...typeDiff.added])];
  const missingErrors = [...new Set([...errorsDiff.removed, ...typeDiff.removed])];

  const severityBefore = beforeAnalysis.severity;
  const severityAfter = afterAnalysis.severity;

  const hasNewBadHttp = httpChanges.some((c) => c.after !== null && c.after >= 400);
  const severityWorsened = SEVERITY_ORDER[severityAfter] > SEVERITY_ORDER[severityBefore];
  const regression = newErrors.length > 0 || hasNewBadHttp || severityWorsened;

  const summary = regression
    ? "Regression detected."
    : "No regression detected.";

  return {
    newErrors,
    missingErrors,
    changedHttpStatuses: httpChanges,
    changedExceptionTypes: typeDiff.added,
    changedComponents: componentDiff.added,
    addedLines: addedErrorLines.slice(0, 30),
    removedLines: removedErrorLines.slice(0, 30),
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