"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReopenRequest } from "@/components/AppShell";
import { SaveButton } from "@/components/SaveButton";
import {
  Button,
  Card,
  CopyButton,
  DefinitionList,
  ErrorNote,
  Field,
  Input,
  ResultBlock,
  SeverityBadge,
  TextArea,
  Toolbar,
} from "@/components/ui";
import { extractLogInfo, isLogEmpty } from "@/lib/log-parser/parser";
import { analyzeLog } from "@/lib/rules/engine";
import type { LogParseResult } from "@/types";

const SAMPLE_LOG = `2026-08-21 10:15:22 ERROR PaymentBatch transactionId=ABC123
java.lang.NullPointerException
\tat com.example.PaymentService.process(PaymentService.java:125)
\tat com.example.BatchJob.run(BatchJob.java:80)
Caused by: java.sql.SQLException: Connection refused on host 10.0.0.5:5432
\tat com.example.db.Pool.getConnection(Pool.java:42)
2026-08-21 10:15:21 WARN PaymentBatch slow query: 12.4s timeout=30s`;

const SAMPLES: Array<{ label: string; text: string }> = [
  { label: "NullPointer + connection", text: SAMPLE_LOG },
  {
    label: "HTTP 500",
    text: "2026-08-21 14:02:11 ERROR OrderApi POST /api/orders HTTP 500\nat com.example.OrderService.create(OrderService.java:90)\nDownstream payment API returned status 503",
  },
  {
    label: "Deadlock",
    text: "2026-08-21 09:30:00 ERROR LedgerTransaction SQLSTATE 40001 deadlock detected\nat com.example.LedgerDao.update(LedgerDao.java:77)",
  },
  {
    label: "Timeout",
    text: "2026-08-21 11:45:33 ERROR ReportJob read timeout after 30s calling DataWarehouse\nat com.example.ReportClient.fetch(ReportClient.java:55)",
  },
];

function buildReport(result: LogParseResult): string {
  const { analysis, info } = result;
  const lines: string[] = [];
  lines.push(`Severity: ${analysis.severity}`);
  lines.push(`Error types: ${analysis.errorTypes.join(", ") || "none"}`);
  lines.push(`Components: ${analysis.affectedComponents.join(", ") || "—"}`);
  if (Object.keys(info.identifiers).length > 0) {
    lines.push(
      `Identifiers: ${Object.entries(info.identifiers)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")}`,
    );
  }
  lines.push("");
  lines.push("Possible root causes:");
  lines.push(...analysis.rootCauses.map((c) => `  - ${c}`));
  lines.push("");
  lines.push("Immediate investigation:");
  analysis.immediateInvestigation.forEach((step, i) => lines.push(`  ${i + 1}. ${step}`));
  lines.push("");
  lines.push("Suggested fixes:");
  lines.push(...analysis.suggestedFixes.map((f) => `  - ${f}`));
  lines.push("");
  lines.push("Long-term improvements:");
  lines.push(...analysis.longTermImprovements.map((f) => `  - ${f}`));
  if (analysis.matchedEvidence.length > 0) {
    lines.push("");
    lines.push("Matched rules (evidence):");
    for (const m of analysis.matchedEvidence) {
      lines.push(
        `  - ${m.ruleName}: ${m.evidence.map((e) => `line ${e.line}`).join(", ")}`,
      );
    }
  }
  if (analysis.unknownTriage) {
    lines.push("");
    lines.push("Unknown error triage:");
    if (analysis.unknownTriage.languageHint) {
      lines.push(`  Language hint: ${analysis.unknownTriage.languageHint}`);
    }
    if (analysis.unknownTriage.httpDirection) {
      const direction =
        analysis.unknownTriage.httpDirection === "client"
          ? "client-side (4xx)"
          : "server-side (5xx)";
      lines.push(`  Direction: ${direction}`);
    }
    lines.push(
      `  Triage causes: ${analysis.unknownTriage.causes.join(" | ")}`,
    );
  }
  return lines.join("\n");
}

export function LogAnalyzer({ reopen }: { reopen?: ReopenRequest }) {
  const [text, setText] = useState("");
  const [system, setSystem] = useState("");
  const [result, setResult] = useState<LogParseResult | null>(null);
  const [error, setError] = useState("");

  const runAnalysis = useCallback((value: string): LogParseResult | null => {
    if (isLogEmpty(value)) {
      setError("Please paste a log before analysis.");
      setResult(null);
      return null;
    }
    setError("");
    const info = extractLogInfo(value);
    const analysis = analyzeLog(value, info);
    const r = { analysis, info };
    setResult(r);
    return r;
  }, []);

  // Support History -> re-open this analysis.
  useEffect(() => {
    if (reopen && typeof reopen.payload === "object" && reopen.payload !== null) {
      const payload = reopen.payload as { input?: string; system?: string };
      if (typeof payload.input === "string") {
        setText(payload.input);
        setSystem(payload.system ?? "");
        runAnalysis(payload.input);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reopen?.key]);

  const summary = useMemo(() => {
    if (!result) return "";
    const exception = result.info.exceptions[0];
    const component = result.info.components[0] ?? "log";
    return exception ? `${exception} in ${component}` : `${component} analysis`;
  }, [result]);

  return (
    <div className="space-y-4">
      <Card
        title="Log Input"
        description="Paste application logs. Analysis runs locally with a built-in rule engine — no AI API, no upload."
        actions={
          <div className="flex items-center gap-2">
            <select
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              defaultValue=""
              aria-label="Load sample log"
              onChange={(e) => {
                if (!e.target.value) return;
                const sample = SAMPLES.find((s) => s.label === e.target.value);
                if (sample) {
                  setText(sample.text);
                  setResult(null);
                  setError("");
                }
                e.target.value = "";
              }}
            >
              <option value="" disabled>
                Load sample…
              </option>
              {SAMPLES.map((s) => (
                <option key={s.label} value={s.label}>
                  {s.label}
                </option>
              ))}
            </select>
            <Button
              variant="primary"
              onClick={() => runAnalysis(text)}
              disabled={!text.trim()}
            >
              Analyze Log
            </Button>
          </div>
        }
      >
        <TextArea
          mono
          rows={12}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Paste log here… e.g.\n\n2026-08-21 10:15:22 ERROR PaymentBatch\ntransactionId=ABC123\njava.lang.NullPointerException\n\tat com.example.PaymentService.process(PaymentService.java:125)`}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <Toolbar
            onClear={() => {
              setText("");
              setResult(null);
              setError("");
            }}
            clearDisabled={!text && !result}
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setText(SAMPLES[0].text);
                setResult(null);
                setError("");
              }}
            >
              Insert sample
            </Button>
            {result && <CopyButton text={buildReport(result)} label="Copy report" />}
          </Toolbar>
          {error && <ErrorNote message={error} />}
        </div>
      </Card>

      {result && (
        <>
          <Card title="Analysis Result">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Overall severity
              </span>
              <SeverityBadge severity={result.analysis.severity} />
              <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">
                matched {result.analysis.matchedRuleIds.length} rule
                {result.analysis.matchedRuleIds.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <ResultBlock title="Error Type">
                {result.analysis.errorTypes.length > 0 ? (
                  <ul className="space-y-1 px-3 py-2">
                    {result.analysis.errorTypes.map((t) => (
                      <li key={t} className="font-mono text-[13px] text-red-700 dark:text-red-300">
                        {t}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">
                    No known error pattern matched.
                  </p>
                )}
              </ResultBlock>

              <ResultBlock title="Affected Component">
                <ul className="space-y-1 px-3 py-2">
                  {result.analysis.affectedComponents.map((c) => (
                    <li key={c} className="font-mono text-[13px] text-zinc-800 dark:text-zinc-200">
                      {c}
                    </li>
                  ))}
                  {result.analysis.affectedComponents.length === 0 && (
                    <li className="text-sm text-zinc-500 dark:text-zinc-400">—</li>
                  )}
                </ul>
              </ResultBlock>
            </div>

            <div className="mt-4">
              <ResultBlock title="Possible Root Cause">
                <ul className="space-y-1.5 px-3 py-2">
                  {result.analysis.rootCauses.map((cause) => (
                    <li key={cause} className="flex gap-2 text-sm text-zinc-800 dark:text-zinc-200">
                      <span className="text-blue-600 dark:text-blue-400">•</span>
                      {cause}
                    </li>
                  ))}
                </ul>
              </ResultBlock>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <ResultBlock title="Immediate Investigation">
                <ol className="space-y-1.5 px-3 py-2">
                  {result.analysis.immediateInvestigation.map((step, i) => (
                    <li
                      key={step}
                      className="flex gap-2 text-sm text-zinc-800 dark:text-zinc-200"
                    >
                      <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
                        {i + 1}.
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
              </ResultBlock>

              <div className="space-y-4">
                <ResultBlock title="Suggested Fix">
                  <ul className="space-y-1.5 px-3 py-2">
                    {result.analysis.suggestedFixes.map((fix) => (
                      <li key={fix} className="flex gap-2 text-sm text-zinc-800 dark:text-zinc-200">
                        <span className="text-emerald-600 dark:text-emerald-400">•</span>
                        {fix}
                      </li>
                    ))}
                  </ul>
                </ResultBlock>
                <ResultBlock title="Long-term Improvement">
                  <ul className="space-y-1.5 px-3 py-2">
                    {result.analysis.longTermImprovements.map((imp) => (
                      <li key={imp} className="flex gap-2 text-sm text-zinc-800 dark:text-zinc-200">
                        <span className="text-violet-600 dark:text-violet-400">•</span>
                        {imp}
                      </li>
                    ))}
                  </ul>
                </ResultBlock>
              </div>
            </div>

            {result.analysis.matchedEvidence.length > 0 && (
              <div className="mt-4">
                <ResultBlock title="Rule Match Evidence">
                  <ul className="space-y-2 px-3 py-2">
                    {result.analysis.matchedEvidence.map((m) => (
                      <li key={m.ruleId} className="text-sm text-zinc-800 dark:text-zinc-200">
                        <span className="font-medium text-zinc-600 dark:text-zinc-300">
                          {m.ruleName}
                        </span>
                        <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">
                          hit {m.evidence.length} line{m.evidence.length === 1 ? "" : "s"}
                        </span>
                        <ul className="mt-1 space-y-0.5 pl-4">
                          {m.evidence.slice(0, 6).map((e) => (
                            <li
                              key={e.line}
                              className="font-mono text-[12px] text-zinc-500 dark:text-zinc-400"
                            >
                              L{e.line}:{" "}
                              {e.text.length > 110 ? `${e.text.slice(0, 110)}…` : e.text}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </ResultBlock>
              </div>
            )}

            {result.analysis.unknownTriage && (
              <div className="mt-4">
                <ResultBlock title="Unknown Error — Analysis Context">
                  <ul className="space-y-1 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200">
                    <li>
                      <span className="font-medium text-zinc-600 dark:text-zinc-300">
                        Language / framework:
                      </span>{" "}
                      {result.analysis.unknownTriage.languageHint ?? "unrecognised"}
                    </li>
                    <li>
                      <span className="font-medium text-zinc-600 dark:text-zinc-300">
                        HTTP direction:
                      </span>{" "}
                      {result.analysis.unknownTriage.httpDirection === "client"
                        ? "client-side (4xx)"
                        : result.analysis.unknownTriage.httpDirection === "server"
                          ? "server-side (5xx)"
                          : "no HTTP status found"}
                    </li>
                  </ul>
                </ResultBlock>
              </div>
            )}
          </Card>

          <Card title="Extracted Information">
            <div className="space-y-4">
              <DefinitionList
                items={[
                  ["Timestamp", result.info.timestamps[0] ?? null],
                  ["Level", result.info.levels.join(", ")],
                  ["Component", result.info.components.join(", ")],
                  ["Exception", result.info.exceptions.join(", ")],
                  ...Object.entries(result.info.identifiers).map<[string, string]>(([k, v]) => [
                    k,
                    v,
                  ]),
                ]}
              />
              {result.info.sources.length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Source references
                  </p>
                  <pre className="overflow-x-auto rounded-md bg-zinc-950 px-3 py-2 font-mono text-[12px] leading-relaxed text-zinc-100 dark:bg-black/40">
                    {result.info.sources
                      .map((s) => (s.symbol ? `${s.symbol} (${s.file}:${s.line ?? "?"})` : `${s.file}:${s.line ?? "?"}`))
                      .join("\n")}
                  </pre>
                </div>
              )}
            </div>
          </Card>

          <Card
            title="Save Analysis"
            description="Stored only when you click Save. Check the warning if sensitive data is detected."
          >
            <Field label="System / component (optional)">
              <Input
                placeholder="e.g. PaymentBatch"
                value={system}
                onChange={(e) => setSystem(e.target.value)}
                className="max-w-xs"
              />
            </Field>
            <div className="mt-3">
              <SaveButton
                tool="log-analyzer"
                system={system}
                summary={summary}
                severity={result.analysis.severity}
                payload={JSON.stringify({ input: text, system })}
                sensitiveText={text}
              />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}