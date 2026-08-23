import { RULES } from "@/lib/rules/rules";

/**
 * Rule-engine evaluation core (local, zero AI cost). Runs the deterministic
 * rule catalogue over every line of a log file and compares per-line
 * "flagged" predictions against optional anomaly labels (e.g. LogHub's
 * VM-instance labels for OpenStack, or app-level labels for Hadoop).
 *
 * IMPORTANT: this scanner deliberately has NO per-rule evidence cap. The UI
 * engine caps collected evidence at MAX_EVIDENCE_LINES_PER_RULE=8 per rule
 * (for display); a benchmark must count every matching line, so the same
 * RULES + patterns are evaluated here without truncation.
 *
 * Pure and unit-tested; the CLI in scripts/eval.ts is a thin wrapper.
 */

export interface EvalRecord {
  /** 1-based line number. */
  line: number;
  flagged: boolean;
  ruleIds: string[];
  /** Line-level ground truth (true = anomalous), or null when unlabelled. */
  label: boolean | null;
}

export interface EvalMetrics {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  /** null when no positive prediction was made. */
  precision: number | null;
  /** null when there are no positive labels. */
  recall: number | null;
  /** null when precision or recall is undefined. */
  f1: number | null;
  accuracy: number;
  flaggedCount: number;
  positiveCount: number;
}

export interface EvalFileResult {
  lineCount: number;
  records: EvalRecord[];
  metrics: EvalMetrics | null;
  /** ruleId -> number of lines it matched (uncapped). */
  ruleHitCounts: Record<string, number>;
  timeMs: number;
}

/** Standard binary-classification metrics. */
export function computeMetrics(
  flaggedLines: number[],
  positiveLines: number[],
  totalLines: number,
): EvalMetrics {
  const flagged = new Set(flaggedLines);
  const positives = new Set(positiveLines);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (let line = 1; line <= totalLines; line++) {
    const isFlagged = flagged.has(line);
    const isPositive = positives.has(line);
    if (isFlagged && isPositive) tp += 1;
    else if (isFlagged && !isPositive) fp += 1;
    else if (!isFlagged && isPositive) fn += 1;
    else tn += 1;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null;
  const accuracy = totalLines > 0 ? (tp + tn) / totalLines : 0;
  return {
    tp,
    fp,
    tn,
    fn,
    precision,
    recall,
    f1,
    accuracy,
    flaggedCount: flaggedLines.length,
    positiveCount: positiveLines.length,
  };
}

/** Simple keyword baseline: ERROR/FATAL/SEVERE/CRITICAL level lines. */
export function baselineErrorLevelFlag(lines: string[]): number[] {
  const out: number[] = [];
  const re = /\b(ERROR|FATAL|SEVERE|CRITICAL)\b/i;
  lines.forEach((line, index) => {
    if (re.test(line)) out.push(index + 1);
  });
  return out;
}

/**
 * Run the rule catalogue over a log file. When `isPositive` is provided the
 * line-level metrics are computed (1-based line numbers). No per-rule cap.
 */
export function evaluateLogFile(
  text: string,
  isPositive?: (lineText: string) => boolean,
): EvalFileResult {
  const start = Date.now();
  const lines = text.split(/\r?\n/);

  const flaggedLines: number[] = [];
  const ruleIdsByLine = new Map<number, string[]>();
  const ruleHitCounts: Record<string, number> = {};

  // Uncapped, line-scoped scan using the exact same rules/patterns as the UI.
  for (const rule of RULES) {
    let ruleHits = 0;
    for (let index = 0; index < lines.length; index++) {
      if (rule.patterns.some((pattern) => pattern.test(lines[index]))) {
        ruleHits += 1;
        const lineNo = index + 1;
        const list = ruleIdsByLine.get(lineNo);
        if (list) {
          list.push(rule.id);
        } else {
          ruleIdsByLine.set(lineNo, [rule.id]);
        }
      }
    }
    if (ruleHits > 0) ruleHitCounts[rule.id] = ruleHits;
  }
  for (const line of ruleIdsByLine.keys()) flaggedLines.push(line);

  const positiveLines: number[] = [];
  const records: EvalRecord[] = lines.map((lineText, index) => {
    const lineNo = index + 1;
    const label = isPositive ? isPositive(lineText) : null;
    if (label) positiveLines.push(lineNo);
    return {
      line: lineNo,
      flagged: ruleIdsByLine.has(lineNo),
      ruleIds: ruleIdsByLine.get(lineNo) ?? [],
      label,
    };
  });

  return {
    lineCount: lines.length,
    records,
    metrics:
      isPositive !== undefined
        ? computeMetrics(flaggedLines, positiveLines, lines.length)
        : null,
    ruleHitCounts,
    timeMs: Date.now() - start,
  };
}

export { RULES } from "@/lib/rules/rules";