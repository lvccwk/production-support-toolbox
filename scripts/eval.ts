/**
 * npm run eval — local rule-engine benchmark over LogHub-style log files.
 *
 * Usage: npm run eval [-- --dir <folder>]
 *   default: data/loghub  (expects *.log files and optional anomaly_labels.txt)
 *
 * For each log file it reports flagged lines / rule-hit distribution, and
 * when anomaly_labels.txt is present (OpenStack-style VM-instance labels),
 * line-level precision / recall / F1 of the rule engine vs a plain
 * ERROR-level keyword baseline.
 */

import fs from "node:fs";
import path from "node:path";
import { evaluateLogFile, baselineErrorLevelFlag, computeMetrics } from "@/lib/eval/runner";

const DEFAULT_DIR = "data/loghub";

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function fmt(value: number | null, digits = 3): string {
  return value === null ? "—" : value.toFixed(digits);
}

function pct(part: number, total: number): string {
  return total === 0 ? "—" : `${((part / total) * 100).toFixed(2)}%`;
}

function loadLabels(dir: string): RegExp | null {
  const labelFile = path.join(dir, "anomaly_labels.txt");
  if (!fs.existsSync(labelFile)) return null;
  const uuids = fs
    .readFileSync(labelFile, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(l));
  if (uuids.length === 0) return null;
  return new RegExp(`\\b(${uuids.join("|")})\\b`, "i");
}

function printMetrics(title: string, flagged: number[], positives: number[], total: number): void {
  const m = computeMetrics(flagged, positives, total);
  console.log(
    `  ${title.padEnd(9)} P=${fmt(m.precision)}  R=${fmt(m.recall)}  F1=${fmt(m.f1)}  ` +
      `acc=${fmt(m.accuracy)}  TP=${m.tp} FP=${m.fp} FN=${m.fn} TN=${m.tn}`,
  );
}

async function main(): Promise<void> {
  const dir = path.resolve(argValue("--dir", DEFAULT_DIR));
  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".log"))
    .sort();
  if (files.length === 0) {
    console.error(`No *.log files found in ${dir}`);
    process.exit(1);
  }

  const labelRe = loadLabels(dir);
  console.log(`=== Rule-engine evaluation: ${path.relative(process.cwd(), dir) || dir} ===`);
  if (labelRe) {
    console.log("(line-level ground truth: lines mentioning an anomalous VM instance)");
    console.log("(metrics apply to the *abnormal* file only — OpenStack convention;");
    console.log(" normal files may mention the same instances without being anomalous)");
  } else {
    console.log("(no anomaly_labels.txt — metrics will be skipped; add labels to get P/R/F1)");
  }
  console.log("");

  const aggregate: {
    name: string;
    engine: { flagged: number[]; positives: number[]; total: number };
    baseline: { flagged: number[] };
  }[] = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    const text = fs.readFileSync(filePath, "utf8");
    const lines = text.split(/\r?\n/);
    // OpenStack labels are per anomalous VM instance; only the abnormal log
    // carries the injected anomalies, so label-based metrics apply there.
    const labelled = labelRe !== null && /abnormal/i.test(file);
    const isPositive = labelled ? (line: string) => labelRe!.test(line) : undefined;

    const result = evaluateLogFile(text, isPositive);
    const baseline = baselineErrorLevelFlag(lines);
    const flaggedLines = result.records.filter((r) => r.flagged).map((r) => r.line);
    const positives = result.metrics ? lines.map((_, i) => i + 1).filter((n) => labelRe!.test(lines[n - 1])) : [];

    console.log(file);
    console.log(
      `  lines=${result.lineCount}  rule-flagged=${flaggedLines.length} (${pct(flaggedLines.length, result.lineCount)})  ` +
        `baseline-flagged=${baseline.length} (${pct(baseline.length, result.lineCount)})  time=${result.timeMs}ms`,
    );
    const hits = Object.entries(result.ruleHitCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    if (hits.length > 0) {
      console.log(`  top rules: ${hits.map(([id, n]) => `${id}×${n}`).join(", ")}`);
    }
    if (result.metrics) {
      console.log("  [labelled]");
      printMetrics("engine", flaggedLines, positives, result.lineCount);
      printMetrics("baseline", baseline, positives, result.lineCount);
      aggregate.push({
        name: file,
        engine: { flagged: flaggedLines, positives, total: result.lineCount },
        baseline: { flagged: baseline },
      });
    }
    console.log("");
  }

  if (aggregate.length > 1) {
    console.log("=== Aggregate (labelled files only) ===");
    const totalLines = aggregate.reduce((s, a) => s + a.engine.total, 0);
    const positives = aggregate.flatMap((a) => a.engine.positives);
    const engineFlagged = aggregate.flatMap((a) => a.engine.flagged);
    const baselineFlagged = aggregate.flatMap((a) => a.baseline.flagged);
    printMetrics("engine", engineFlagged, positives, totalLines);
    printMetrics("baseline", baselineFlagged, positives, totalLines);
    console.log("");
  }

  console.log("Caveats:");
  console.log(
    "  - The rule engine is tuned for crash/exception-style application logs;",
  );
  console.log(
    "    infrastructure datasets (OpenStack) inject behavioural anomalies that may",
  );
  console.log(
    "    not carry ERROR keywords — low recall is expected and informative, not a bug.",
  );
  console.log(
    "  - Label granularity matters: OpenStack labels are per VM instance; we map them",
  );
  console.log(
    "    to lines mentioning those instances (a conservative approximation).",
  );
}

void main();