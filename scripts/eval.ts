/**
 * npm run eval — local rule-engine benchmark over LogHub-style log files.
 *
 * Usage:
 *   npm run eval                          # scan data/loghub, console only
 *   npm run eval -- --dir <folder>        # any folder with *.log files
 *   npm run eval -- --report <file.md>    # also write a Markdown report
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

/** One line of metrics for the report / console. */
function metricsLine(title: string, flagged: number[], positives: number[], total: number): string {
  const m = computeMetrics(flagged, positives, total);
  return (
    `| ${title} | ${fmt(m.precision)} | ${fmt(m.recall)} | ${fmt(m.f1)} | ${fmt(m.accuracy)} | ` +
    `${m.tp}/${m.fp}/${m.fn}/${m.tn} | ${m.flaggedCount} | ${m.positiveCount} |`
  );
}

async function main(): Promise<void> {
  const dir = path.resolve(argValue("--dir", DEFAULT_DIR));
  const reportPath = argValue("--report", "");
  // File-level ground truth: every line of the *abnormal* file is positive.
  // Used for datasets where anomalies are labelled at the application level
  // (e.g. Hadoop container logs) instead of per line (OpenStack).
  const labelAll = process.argv.includes("--label-all");
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

  const reportLines: string[] = [];
  const out = (line: string): void => {
    console.log(line);
    reportLines.push(line);
  };

  const labelRe = loadLabels(dir);
  reportLines.push(`# Rule-Engine Evaluation Report — ${new Date().toISOString()}`);
  reportLines.push("");
  out(`=== Rule-engine evaluation: ${path.relative(process.cwd(), dir) || dir} ===`);
  if (labelRe) {
    out("(line-level ground truth: lines mentioning an anomalous VM instance)");
    out("(metrics apply to the *abnormal* file only — OpenStack convention;");
    out(" normal files may mention the same instances without being anomalous)");
  } else if (labelAll) {
    out("(file-level ground truth (--label-all): every line of the *abnormal* file counts as positive —");
    out(" application-level labels such as Hadoop's machine-down / disk-full / network-disconnect)");
  } else {
    out("(no anomaly_labels.txt — metrics will be skipped; add labels to get P/R/F1)");
  }
  out("");

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
    // With --label-all, the whole abnormal file is the positive class.
    const useLabels = labelAll || labelRe !== null;
    const labelled = useLabels && /abnormal/i.test(file);
    const isPositive = labelled
      ? labelAll
        ? () => true
        : (line: string) => labelRe!.test(line)
      : undefined;

    const result = evaluateLogFile(text, isPositive);
    const baseline = baselineErrorLevelFlag(lines);
    const flaggedLines = result.records.filter((r) => r.flagged).map((r) => r.line);
    const positives = result.metrics
      ? labelAll
        ? lines.map((_, i) => i + 1)
        : lines.map((_, i) => i + 1).filter((n) => labelRe!.test(lines[n - 1]))
      : [];

    out(`## ${file}`);
    out("");
    out(
      `- lines: ${result.lineCount} | rule-flagged: ${flaggedLines.length} (${pct(flaggedLines.length, result.lineCount)}) | ` +
        `baseline-flagged: ${baseline.length} (${pct(baseline.length, result.lineCount)}) | time: ${result.timeMs} ms`,
    );
    const hits = Object.entries(result.ruleHitCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    if (hits.length > 0) {
      out(`- top rules: ${hits.map(([id, n]) => `${id}×${n}`).join(", ")}`);
    }
    out("");
    if (result.metrics) {
      out("| detector | precision | recall | F1 | accuracy | TP/FP/FN/TN | flagged | positives |");
      out("| --- | --- | --- | --- | --- | --- | --- | --- |");
      out(metricsLine("engine", flaggedLines, positives, result.lineCount));
      out(metricsLine("baseline", baseline, positives, result.lineCount));
      out("");
      aggregate.push({
        name: file,
        engine: { flagged: flaggedLines, positives, total: result.lineCount },
        baseline: { flagged: baseline },
      });
    }
  }

  if (aggregate.length > 1) {
    out("## Aggregate (labelled files only)");
    out("");
    const totalLines = aggregate.reduce((s, a) => s + a.engine.total, 0);
    const positives = aggregate.flatMap((a) => a.engine.positives);
    const engineFlagged = aggregate.flatMap((a) => a.engine.flagged);
    const baselineFlagged = aggregate.flatMap((a) => a.baseline.flagged);
    out("| detector | precision | recall | F1 | accuracy | TP/FP/FN/TN | flagged | positives |");
    out("| --- | --- | --- | --- | --- | --- | --- | --- |");
    out(metricsLine("engine", engineFlagged, positives, totalLines));
    out(metricsLine("baseline", baselineFlagged, positives, totalLines));
    out("");
  }

  out("## Caveats");
  out("");
  out(
    "- The rule engine is tuned for crash/exception-style application logs; datasets that inject behavioural anomalies without ERROR keywords (e.g. OpenStack VM failures) will show near-zero recall — an honest domain-mismatch measurement, not a bug.",
  );
  out(
    "- Label granularity differs per dataset: OpenStack labels are per VM instance (mapped to lines mentioning those instances); Hadoop labels are per application (here every line of the failing apps counts as positive, which dilutes recall). Prefer the flagged-rate ratio (abnormal vs normal) over raw recall for app-level labels.",
  );
  out(
    "- The benchmark scans every line with no per-rule evidence cap (the UI engine caps display evidence at 8 lines/rule).",
  );

  if (reportPath) {
    fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
    fs.writeFileSync(path.resolve(reportPath), reportLines.join("\n") + "\n", "utf8");
    out(`\nReport written to ${reportPath}`);
  }
}

void main();