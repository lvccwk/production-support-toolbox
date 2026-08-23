"use client";

import { useEffect, useMemo, useState } from "react";
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
import { scopeMatches, toLogRules } from "@/lib/rules/custom";
import type { CustomRule, LogParseResult } from "@/types";

/** Shape of the enriched server analysis (rule engine + AI fallback). */
interface ServerAnalyzeData {
  severity: string;
  errorTypes: string[];
  rootCauses: string[];
  rootCausesZh?: string[];
  immediateInvestigation: string[];
  immediateInvestigationZh?: string[];
  suggestedFixes: string[];
  suggestedFixesZh?: string[];
  longTermImprovements: string[];
  longTermImprovementsZh?: string[];
  analysisSource?: "rules" | "ai-fallback";
  aiFallback?: {
    cached: boolean;
    model?: string | null;
    confidence: number;
  } | null;
}

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
  /** Zip the zh/en arrays into aligned pairs (EN treated as the source). */
  const pairs = (zh: string[] | undefined, en: string[]): Array<{ zh: string; en: string }> =>
    en.map((text, i) => ({ zh: zh?.[i] ?? text, en: text }));
  const [text, setText] = useState("");
  const [system, setSystem] = useState("");
  const [result, setResult] = useState<LogParseResult | null>(null);
  const [error, setError] = useState("");
  const [customRules, setCustomRules] = useState<CustomRule[]>([]);
  const [customRuleInfo, setCustomRuleInfo] = useState("");
  const [customRuleError, setCustomRuleError] = useState("");
  /** Analysis text display: 中英並排 (default, English for learning) / 中文 / English. */
  const [langMode, setLangMode] = useState<"both" | "zh" | "en">("both");

  /** Opt-in AI fallback result when the rule engine matched nothing. */
  const [aiResult, setAiResult] = useState<ServerAnalyzeData | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  const runAiFallback = async () => {
    setAiLoading(true);
    setAiError("");
    try {
      const res = await fetch("/api/tools/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logs: [text], system }),
      });
      const json = (await res.json()) as { ok?: boolean; data?: ServerAnalyzeData; error?: string };
      if (!res.ok || !json?.ok || !json.data) {
        setAiError(json?.error ?? "AI 補充分析失敗。");
        return;
      }
      setAiResult(json.data);
    } catch {
      setAiError("AI 補充分析失敗（網路錯誤）。");
    } finally {
      setAiLoading(false);
    }
  };

  // Load active custom rules from the local registry so the GUI uses the
  // same company/system rules as the agent API (scope applied per analysis).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/tools/rules")
      .then((res) => res.json())
      .then((json: { ok?: boolean; data?: { rules?: CustomRule[] } }) => {
        if (cancelled || !json?.ok || !json.data) return;
        const active = json.data.rules?.filter((r) => r.active) ?? [];
        setCustomRules(active);
        setCustomRuleInfo(active.length > 0 ? `${active.length} 條自訂規則已載入` : "");
      })
      .catch(() => {
        if (!cancelled) setCustomRuleError("自訂規則載入失敗（以內建規則分析）");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const runAnalysis = (value: string): LogParseResult | null => {
    if (isLogEmpty(value)) {
      setError("Please paste a log before analysis.");
      setResult(null);
      return null;
    }
    setError("");
    const info = extractLogInfo(value);
    // Apply only custom rules whose scope matches this analysis.
    const applicable = customRules.filter((rule) => {
      const isActive = rule.active;
      const inScope = scopeMatches(rule.scope, {
        system,
        components: info.components,
      });
      return isActive && inScope;
    });
    const analysis = analyzeLog(value, info, toLogRules(applicable));
    const r = { analysis, info };
    setResult(r);
    return r;
  };

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
          {!error && customRuleError && (
            <div className="mt-2">
              <ErrorNote message={customRuleError} />
            </div>
          )}
          {!error && !customRuleError && customRuleInfo && (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{customRuleInfo}</p>
          )}
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
              <select
                value={langMode}
                onChange={(e) => setLangMode(e.target.value as "both" | "zh" | "en")}
                className="ml-auto rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                title="Analysis display language (English shown for learning)"
              >
                <option value="both">中英並排</option>
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
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
                  <div className="px-3 py-2">
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      No known error pattern matched.
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      onClick={() => void runAiFallback()}
                      disabled={aiLoading}
                    >
                      {aiLoading ? "AI 分析中…" : "AI 補充分析（未命中規則）"}
                    </Button>
                    {aiError && (
                      <p className="mt-2 text-xs text-red-600 dark:text-red-400">{aiError}</p>
                    )}
                  </div>
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
                <ul className="space-y-2 px-3 py-2">
                  {pairs(result.analysis.rootCausesZh, result.analysis.rootCauses).map(
                    ({ zh, en }) => (
                      <li key={en} className="text-sm text-zinc-800 dark:text-zinc-200">
                        <span className="flex gap-2">
                          <span className="text-blue-600 dark:text-blue-400">•</span>
                          {langMode === "en" ? en : zh}
                        </span>
                        {langMode === "both" && (
                          <span className="mt-0.5 block pl-5 text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
                            {en}
                          </span>
                        )}
                      </li>
                    ),
                  )}
                </ul>
              </ResultBlock>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <ResultBlock title="Immediate Investigation">
                <ol className="space-y-2 px-3 py-2">
                  {pairs(
                    result.analysis.immediateInvestigationZh,
                    result.analysis.immediateInvestigation,
                  ).map(({ zh, en }, i) => (
                    <li key={en} className="text-sm text-zinc-800 dark:text-zinc-200">
                      <span className="flex gap-2">
                        <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
                          {i + 1}.
                        </span>
                        {langMode === "en" ? en : zh}
                      </span>
                      {langMode === "both" && (
                        <span className="mt-0.5 block pl-5 text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
                          {en}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </ResultBlock>

              <div className="space-y-4">
                <ResultBlock title="Suggested Fix">
                  <ul className="space-y-2 px-3 py-2">
                    {pairs(
                      result.analysis.suggestedFixesZh,
                      result.analysis.suggestedFixes,
                    ).map(({ zh, en }) => (
                      <li key={en} className="text-sm text-zinc-800 dark:text-zinc-200">
                        <span className="flex gap-2">
                          <span className="text-emerald-600 dark:text-emerald-400">•</span>
                          {langMode === "en" ? en : zh}
                        </span>
                        {langMode === "both" && (
                          <span className="mt-0.5 block pl-5 text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
                            {en}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </ResultBlock>
                <ResultBlock title="Long-term Improvement">
                  <ul className="space-y-2 px-3 py-2">
                    {pairs(
                      result.analysis.longTermImprovementsZh,
                      result.analysis.longTermImprovements,
                    ).map(({ zh, en }) => (
                      <li key={en} className="text-sm text-zinc-800 dark:text-zinc-200">
                        <span className="flex gap-2">
                          <span className="text-violet-600 dark:text-violet-400">•</span>
                          {langMode === "en" ? en : zh}
                        </span>
                        {langMode === "both" && (
                          <span className="mt-0.5 block pl-5 text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
                            {en}
                          </span>
                        )}
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

                  {(result.analysis.unknownTriage.causes.length > 0 ||
                    result.analysis.unknownTriage.investigation.length > 0) && (
                    <div className="mt-2 space-y-3 px-3 pb-3">
                      {result.analysis.unknownTriage.causes.length > 0 && (
                        <div>
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                            Triage causes
                          </p>
                          <ul className="space-y-2 text-sm text-zinc-800 dark:text-zinc-200">
                            {pairs(
                              result.analysis.unknownTriage.causesZh,
                              result.analysis.unknownTriage.causes,
                            ).map(({ zh, en }) => (
                              <li key={en}>
                                <span>{langMode === "en" ? en : zh}</span>
                                {langMode === "both" && (
                                  <span className="mt-0.5 block pl-1 text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
                                    {en}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {result.analysis.unknownTriage.investigation.length > 0 && (
                        <div>
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                            Triage investigation
                          </p>
                          <ul className="space-y-2 text-sm text-zinc-800 dark:text-zinc-200">
                            {pairs(
                              result.analysis.unknownTriage.investigationZh,
                              result.analysis.unknownTriage.investigation,
                            ).map(({ zh, en }) => (
                              <li key={en}>
                                <span>{langMode === "en" ? en : zh}</span>
                                {langMode === "both" && (
                                  <span className="mt-0.5 block pl-1 text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
                                    {en}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </ResultBlock>
              </div>
            )}
          </Card>

          {aiResult && aiResult.analysisSource === "ai-fallback" && (
            <Card
              title="AI 補充分析（規則未命中）"
              description={
                aiResult.aiFallback
                  ? `AI 推測（confidence ${Math.round(aiResult.aiFallback.confidence * 100)}%${
                      aiResult.aiFallback.cached ? "，來自快取" : "，本次外送 OpenRouter"
                    }）— 僅供參考，不覆寫規則引擎。`
                  : "AI 補充分析"
              }
            >
              <div className="flex flex-wrap items-center gap-3">
                <SeverityBadge severity={aiResult.severity} />
                {aiResult.errorTypes.map((t) => (
                  <span
                    key={t}
                    className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                  >
                    {t}
                  </span>
                ))}
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <ResultBlock title="Possible Root Cause">
                  <ul className="space-y-2 px-3 py-2">
                    {pairs(aiResult.rootCausesZh, aiResult.rootCauses).map(({ zh, en }) => (
                      <li key={en} className="text-sm text-zinc-800 dark:text-zinc-200">
                        <span>{langMode === "en" ? en : zh}</span>
                        {langMode === "both" && (
                          <span className="mt-0.5 block pl-1 text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
                            {en}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </ResultBlock>
                <ResultBlock title="Immediate Investigation">
                  <ol className="space-y-2 px-3 py-2">
                    {pairs(aiResult.immediateInvestigationZh, aiResult.immediateInvestigation).map(
                      ({ zh, en }, i) => (
                        <li key={en} className="text-sm text-zinc-800 dark:text-zinc-200">
                          <span className="flex gap-2">
                            <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
                              {i + 1}.
                            </span>
                            {langMode === "en" ? en : zh}
                          </span>
                          {langMode === "both" && (
                            <span className="mt-0.5 block pl-5 text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
                              {en}
                            </span>
                          )}
                        </li>
                      ),
                    )}
                  </ol>
                </ResultBlock>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <ResultBlock title="Suggested Fix">
                  <ul className="space-y-2 px-3 py-2">
                    {pairs(aiResult.suggestedFixesZh, aiResult.suggestedFixes).map(({ zh, en }) => (
                      <li key={en} className="text-sm text-zinc-800 dark:text-zinc-200">
                        <span>{langMode === "en" ? en : zh}</span>
                        {langMode === "both" && (
                          <span className="mt-0.5 block pl-1 text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
                            {en}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </ResultBlock>
                <ResultBlock title="Long-term Improvement">
                  <ul className="space-y-2 px-3 py-2">
                    {pairs(
                      aiResult.longTermImprovementsZh,
                      aiResult.longTermImprovements,
                    ).map(({ zh, en }) => (
                      <li key={en} className="text-sm text-zinc-800 dark:text-zinc-200">
                        <span>{langMode === "en" ? en : zh}</span>
                        {langMode === "both" && (
                          <span className="mt-0.5 block pl-1 text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
                            {en}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </ResultBlock>
              </div>
            </Card>
          )}

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