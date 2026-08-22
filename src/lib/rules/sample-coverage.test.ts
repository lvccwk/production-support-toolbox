import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractLogInfo } from "@/lib/log-parser/parser";
import { analyzeLog } from "@/lib/rules/engine";
import { triageUnknownError } from "@/lib/rules/triage";

/**
 * Real-log coverage harness (not part of CI).
 *
 * Run when the sample datasets are present:
 *   PST_SAMPLE_COVERAGE=1 npx vitest run src/lib/rules/sample-coverage.test.ts
 *
 * Reads data/sample-logs/*.log (LogHub: https://github.com/logpai/loghub),
 * runs the full parser + rule engine + triage per log, and prints a coverage
 * table: matched/unknown ratios, top rules, extracted fields. Skipped by
 * default so CI never depends on local sample files.
 */

const SAMPLES_DIR = path.join(process.cwd(), "data", "sample-logs");

interface SampleStat {
  file: string;
  lines: number;
  errorLevelLines: number;
  unknownErrors: number;
  matchedLines: number;
  topRules: Array<{ rule: string; hits: number }>;
  exceptions: Set<string>;
  httpStatuses: Set<number>;
  triage: { language: string; direction: string; count: number };
}

function analyzeSample(file: string): SampleStat {
  const text = fs.readFileSync(path.join(SAMPLES_DIR, file), "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const ERROR_LINE_RE = /\b(ERROR|SEVERE|FATAL|CRITICAL|WARN|WARNING|null)\b/i;
  const stat: SampleStat = {
    file,
    lines: lines.length,
    errorLevelLines: 0,
    unknownErrors: 0,
    matchedLines: 0,
    topRules: [],
    exceptions: new Set(),
    httpStatuses: new Set(),
    triage: { language: "", direction: "", count: 0 },
  };

  const ruleHits = new Map<string, number>();
  const languages = new Set<string>();
  const directions = new Set<string>();

  // Analyse the log as a whole (the tool's primary usage: paste whole log).
  const info = extractLogInfo(text);
  const analysis = analyzeLog(text, info);
  info.exceptions.forEach((e) => stat.exceptions.add(e));
  info.httpStatuses.forEach((s) => stat.httpStatuses.add(s));
  stat.errorLevelLines = lines.filter((l) => ERROR_LINE_RE.test(l)).length;
  analysis.matchedRuleIds.forEach((id) => ruleHits.set(id, (ruleHits.get(id) ?? 0) + 1));
  if (analysis.errorTypes.includes("Unknown Error")) stat.unknownErrors += 1;
  stat.matchedLines = analysis.matchedEvidence.reduce(
    (n, m) => n + m.evidence.length,
    0,
  );

  if (analysis.unknownTriage) {
    stat.triage.count += 1;
    if (analysis.unknownTriage.languageHint) {
      languages.add(analysis.unknownTriage.languageHint);
    }
    if (analysis.unknownTriage.httpDirection) {
      directions.add(analysis.unknownTriage.httpDirection);
    }
  }
  stat.topRules = [...ruleHits.entries()]
    .map(([id, hits]) => ({ rule: id, hits }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 6);
  stat.triage.language = [...languages].join("|");
  stat.triage.direction = [...directions].join("|");
  return stat;
}

function printReport(stats: SampleStat[]): void {
  const fmtRule = (r: { rule: string; hits: number }) => `${r.rule}(${r.hits})`;
  // eslint-disable-next-line no-console
  console.log(
    [
      "file | lines | errLines | matchedLines | unknown | top rules | exceptions | http | triage(lang/dir)",
      ...stats.map(
        (s) =>
          `${s.file} | ${s.lines} | ${s.errorLevelLines} | ${s.matchedLines} | ${s.unknownErrors} | ${s.topRules.map(fmtRule).join(",") || "-"} | ${[...s.exceptions].slice(0, 4).join(",") || "-"} | ${[...s.httpStatuses].join(",") || "-"} | ${s.triage.language}/${s.triage.direction}`,
      ),
    ].join("\n"),
  );
}

const enabled = process.env.PST_SAMPLE_COVERAGE === "1";

describe.skipIf(!enabled)("real-log coverage (data/sample-logs)", () => {
  it("runs the engine over every sample without throwing", () => {
    expect(fs.existsSync(SAMPLES_DIR)).toBe(true);
    const files = fs
      .readdirSync(SAMPLES_DIR)
      .filter((f) => f.endsWith(".log"))
      .sort();
    expect(files.length).toBeGreaterThan(0);
    const stats = files.map(analyzeSample);
    printReport(stats);
    // Never throws, always returns a structured result.
    for (const stat of stats) {
      expect(stat.lines).toBeGreaterThan(0);
      expect(Array.isArray(stat.topRules)).toBe(true);
    }
  });
});