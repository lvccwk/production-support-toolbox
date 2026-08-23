"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { apiFetch, errorMessage } from "@/lib/api/client";
import type { CustomRule, LogParseResult, Severity } from "@/types";

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
  aiFallbackConfigured?: boolean;
  aiFallbackError?: string | null;
  aiFallback?: {
    cached: boolean;
    model?: string | null;
    confidence: number;
  } | null;
}

/**
 * Minimal SSE block parser for the /analyze/stream endpoint
 * ("event:"/"data:" lines separated by a blank line).
 */
function parseSseBlock(block: string): { event?: string; data: string } | null {
  const lines = block.split(/\r?\n/);
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^\s/, ""));
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

function parseSseJson(data: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(data);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
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

/**
 * Serialize the FULL analysis (rule engine + optional AI fallback, both
 * languages) into the Support History payload, so CSV/JSON exports can break
 * out every field instead of showing only "No known error pattern matched".
 */
function buildSavePayload(
  result: LogParseResult,
  aiResult: ServerAnalyzeData | null,
  text: string,
  system: string,
): string {
  const analysis = result.analysis;
  const ai = aiResult?.analysisSource === "ai-fallback" ? aiResult : null;
  const base: Record<string, unknown> = {
    input: text,
    system,
    analysisSource: ai ? "ai-fallback" : "rules",
    analysis: {
      severity: analysis.severity,
      errorTypes: analysis.errorTypes,
      affectedComponents: analysis.affectedComponents,
      rootCauses: analysis.rootCauses,
      rootCausesZh: analysis.rootCausesZh ?? null,
      immediateInvestigation: analysis.immediateInvestigation,
      immediateInvestigationZh: analysis.immediateInvestigationZh ?? null,
      suggestedFixes: analysis.suggestedFixes,
      suggestedFixesZh: analysis.suggestedFixesZh ?? null,
      longTermImprovements: analysis.longTermImprovements,
      longTermImprovementsZh: analysis.longTermImprovementsZh ?? null,
      matchedRuleIds: analysis.matchedRuleIds,
      unknownTriage: analysis.unknownTriage,
      matchedEvidence: analysis.matchedEvidence.map((m) => ({
        ruleId: m.ruleId,
        ruleName: m.ruleName,
        evidence: m.evidence.map((e) => ({ line: e.line, text: e.text })),
      })),
    },
  };
  if (ai) {
    base.aiFallback = {
      severity: ai.severity,
      errorTypes: ai.errorTypes,
      rootCauses: ai.rootCauses,
      rootCausesZh: ai.rootCausesZh ?? null,
      immediateInvestigation: ai.immediateInvestigation,
      immediateInvestigationZh: ai.immediateInvestigationZh ?? null,
      suggestedFixes: ai.suggestedFixes,
      suggestedFixesZh: ai.suggestedFixesZh ?? null,
      longTermImprovements: ai.longTermImprovements,
      longTermImprovementsZh: ai.longTermImprovementsZh ?? null,
      model: ai.aiFallback?.model ?? null,
      confidence: ai.aiFallback?.confidence ?? null,
      cached: ai.aiFallback?.cached ?? false,
    };
  }
  const full = JSON.stringify(base);
  // History rejects payloads over 200k chars — drop the evidence line TEXT
  // (keep rule refs + line numbers) for huge logs instead of failing the save.
  if (full.length > 200_000) {
    base.analysis = {
      severity: analysis.severity,
      errorTypes: analysis.errorTypes,
      affectedComponents: analysis.affectedComponents,
      rootCauses: analysis.rootCauses,
      rootCausesZh: analysis.rootCausesZh ?? null,
      immediateInvestigation: analysis.immediateInvestigation,
      immediateInvestigationZh: analysis.immediateInvestigationZh ?? null,
      suggestedFixes: analysis.suggestedFixes,
      suggestedFixesZh: analysis.suggestedFixesZh ?? null,
      longTermImprovements: analysis.longTermImprovements,
      longTermImprovementsZh: analysis.longTermImprovementsZh ?? null,
      matchedRuleIds: analysis.matchedRuleIds,
      unknownTriage: analysis.unknownTriage,
      matchedEvidence: analysis.matchedEvidence.map((m) => ({
        ruleId: m.ruleId,
        ruleName: m.ruleName,
        evidence: m.evidence.map((e) => ({ line: e.line, text: e.text.slice(0, 200) })),
      })),
    };
    return JSON.stringify(base);
  }
  return full;
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
  /** Rule-analysis detail sections: auto-collapsed when 0 rules match (the AI
   *  fallback card becomes the focus; the empty dashboard is one click away). */
  const [ruleDetailsOpen, setRuleDetailsOpen] = useState(true);

  /** AI fallback pipeline (auto-triggered when no rule matches). */
  const [aiResult, setAiResult] = useState<ServerAnalyzeData | null>(null);
  const [aiPhase, setAiPhase] = useState<"idle" | "running" | "done">("idle");
  const [aiElapsedSec, setAiElapsedSec] = useState(0);
  const [aiError, setAiError] = useState("");
  /** Tail of the model's in-flight output (SSE deltas) — live progress. */
  const [aiPreview, setAiPreview] = useState("");
  /** True once the server reports PST_AI_FALLBACK is enabled. */
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);
  const aiRunRef = useRef(0);
  const aiCancelledRef = useRef(false);

  /** Stream the AI fallback from the server (cached, masked, bilingual). */
  const triggerAiFallback = async () => {
    const runId = ++aiRunRef.current;
    aiAbortRef.current?.abort();
    aiCancelledRef.current = false;
    setAiPhase("running");
    setAiElapsedSec(0);
    setAiError("");
    setAiConfigured(null);
    setAiPreview("");
    const controller = new AbortController();
    aiAbortRef.current = controller;
    try {
      const res = await apiFetch("/api/tools/analyze/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logs: [text], system }),
        signal: controller.signal,
      });
      if (runId !== aiRunRef.current) return;
      if (!res.ok || !res.body) {
        const json = (await res.json().catch(() => null)) as unknown;
        setAiError(errorMessage(json, "AI 補充分析失敗。"));
        setAiPhase("done");
        return;
      }

      // Consume the SSE stream: phase / delta / ai_result / error / done.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (runId !== aiRunRef.current) return;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const parsed = parseSseBlock(block);
          if (!parsed) continue;
          if (runId !== aiRunRef.current) return;
          const data = parseSseJson(parsed.data);
          switch (parsed.event) {
            case "phase": {
              const configured = data?.aiFallbackConfigured;
              if (typeof configured === "boolean") setAiConfigured(configured);
              break;
            }
            case "delta": {
              const t = typeof data?.text === "string" ? data.text : "";
              if (t) setAiPreview((prev) => (prev + t).slice(-600));
              break;
            }
            case "ai_result":
              if (data?.analysisSource === "ai-fallback") {
                setAiResult(data as unknown as ServerAnalyzeData);
              }
              setAiConfigured(true);
              setAiError("");
              break;
            case "error": {
              const message =
                typeof data?.message === "string" ? data.message : "AI 補充分析失敗。";
              setAiError(message);
              setAiConfigured(message.toLowerCase().includes("disabled") ? false : true);
              setAiPreview("");
              break;
            }
            case "done":
              finished = true;
              break;
          }
          if (finished) break;
        }
        if (finished) break;
      }
      if (runId !== aiRunRef.current) return;
      setAiPhase("done");
    } catch (error) {
      if (runId !== aiRunRef.current) return;
      const aborted =
        error instanceof DOMException
          ? error.name === "AbortError"
          : (error as { name?: string } | null)?.name === "AbortError";
      if (aborted) {
        if (aiCancelledRef.current) setAiError("AI 補充分析已取消。");
      } else {
        setAiError("AI 補充分析失敗（網路錯誤）。");
      }
      setAiPhase("done");
    }
  };

  // Live elapsed-time ticker while the AI fallback is running.
  useEffect(() => {
    if (aiPhase !== "running") return;
    const start = Date.now();
    const timer = setInterval(() => setAiElapsedSec((Date.now() - start) / 1000), 200);
    return () => clearInterval(timer);
  }, [aiPhase]);

  // Abort any in-flight AI call when this view unmounts.
  useEffect(() => () => aiAbortRef.current?.abort(), []);

  // Load active custom rules from the local registry so the GUI uses the
  // same company/system rules as the agent API (scope applied per analysis).
  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/tools/rules")
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
    // Invalidate any in-flight AI fallback and reset its UI state.
    aiRunRef.current++;
    aiAbortRef.current?.abort();
    aiCancelledRef.current = false;
    setAiPhase("idle");
    setAiError("");
    setAiConfigured(null);
    setAiResult(null);
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
    // Auto-collapse the rule dashboard when nothing matched (AI fallback focus).
    setRuleDetailsOpen(analysis.matchedRuleIds.length > 0);
    return r;
  };

  /** Run the local engine, then auto-trigger AI fallback when nothing matches. */
  const runAnalysisWithAi = (value: string): LogParseResult | null => {
    const r = runAnalysis(value);
    if (r && r.analysis.matchedRuleIds.length === 0) {
      void triggerAiFallback();
    }
    return r;
  };

  // Support History -> re-open this analysis.
  useEffect(() => {
    if (reopen && typeof reopen.payload === "object" && reopen.payload !== null) {
      const payload = reopen.payload as { input?: string; system?: string };
      if (typeof payload.input === "string") {
        setText(payload.input);
        setSystem(payload.system ?? "");
        runAnalysisWithAi(payload.input);
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

  // Full analysis snapshot for Support History (rules + AI fallback, bilingual).
  const savePayload = useMemo(
    () => (result ? buildSavePayload(result, aiResult, text, system) : ""),
    [result, aiResult, text, system],
  );

  return (
    <div className="space-y-4">
      <Card
        title="Log Input"
        description="Paste application logs. A local rule engine analyses them; when nothing matches, an optional AI fallback (off unless PST_AI_FALLBACK=true) runs automatically."
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
              onClick={() => runAnalysisWithAi(text)}
              disabled={!text.trim() || aiPhase === "running"}
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
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {result.analysis.matchedRuleIds.length === 0 && (
                  <button
                    type="button"
                    aria-expanded={ruleDetailsOpen}
                    onClick={() => setRuleDetailsOpen((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700/60"
                    title={
                      ruleDetailsOpen
                        ? "Collapse rule result details"
                        : "Expand rule result details"
                    }
                  >
                    {ruleDetailsOpen ? "收起規則細節 ▲" : "展開規則細節 ▼"}
                  </button>
                )}
                <select
                  value={langMode}
                  onChange={(e) => setLangMode(e.target.value as "both" | "zh" | "en")}
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  title="Analysis display language (English shown for learning)"
                >
                  <option value="both">中英並排</option>
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>

            {aiPhase === "running" && (
              <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-800/50 dark:bg-blue-950/40">
                <div className="flex items-center gap-2">
                  <span
                    className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"
                    aria-hidden
                  />
                  <span className="text-sm font-semibold text-blue-800 dark:text-blue-300">
                    AI 補充分析進行中（規則未命中，自動補位）
                  </span>
                  <span className="ml-auto font-mono text-xs text-blue-600 dark:text-blue-400">
                    已 {aiElapsedSec.toFixed(1)}s
                  </span>
                </div>
                <ol className="mt-3 space-y-1.5 text-xs text-blue-900/90 dark:text-blue-200/90">
                  <li className="flex items-center gap-2">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">
                      ✓
                    </span>
                    規則引擎掃描完成 — 未命中任何規則（0 條匹配）
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="flex h-3.5 w-3.5 items-center justify-center">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
                    </span>
                    呼叫 AI（OpenRouter）分析遮蔽後 log…
                  </li>
                  <li className="flex items-center gap-2 opacity-60">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px]">
                      3
                    </span>
                    驗證結構化結果並顯示（雙語）
                  </li>
                </ol>
                <p className="mt-3 text-[11px] leading-relaxed text-blue-700/70 dark:text-blue-300/70">
                  敏感值已於傳送前遮罩；結果會快取，重複分析零成本。
                </p>
                {aiPreview && (
                  <div className="mt-3 rounded-md border border-blue-200 bg-white/70 p-2.5 dark:border-blue-800/50 dark:bg-zinc-900/50">
                    <p className="text-[10px] font-medium tracking-wide text-blue-600/80 dark:text-blue-300/70">
                      MODEL 生成中（即時預覽 — 最終以結構化結果為準）
                    </p>
                    <pre className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                      {aiPreview}…
                    </pre>
                  </div>
                )}
                <div className="mt-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      aiCancelledRef.current = true;
                      aiAbortRef.current?.abort();
                    }}
                  >
                    取消
                  </Button>
                </div>
              </div>
            )}

            {result.analysis.matchedRuleIds.length === 0 && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-800/40 dark:bg-amber-950/20">
                <p className="text-sm text-zinc-700 dark:text-zinc-200">
                  No known error pattern matched. 未有規則命中 — 規則分析儀表板已收合，
                  分析重點見下方 AI 補充分析（可撳「展開規則細節」查看規則引擎結果）。
                </p>
                {aiPhase === "running" ? (
                  <p className="mt-2 animate-pulse text-xs font-medium text-blue-600 dark:text-blue-400">
                    AI 補充分析自動執行中…請看上方進度
                  </p>
                ) : aiError && aiConfigured === false ? (
                  <p className="mt-2 text-xs leading-relaxed text-amber-600 dark:text-amber-400">
                    規則未命中。AI 補充分析未啟用 — 在 .env 設定{" "}
                    <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono dark:bg-zinc-800">
                      PST_AI_FALLBACK=true
                    </code>{" "}
                    並重啟後，規則未命中時會自動以 AI 補位分析。
                  </p>
                ) : aiError ? (
                  <div className="mt-2">
                    <p className="text-xs text-red-600 dark:text-red-400">{aiError}</p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      onClick={() => void triggerAiFallback()}
                    >
                      重試 AI 補充分析
                    </Button>
                  </div>
                ) : null}
              </div>
            )}

            {(result.analysis.matchedRuleIds.length > 0 || ruleDetailsOpen) && (
              <>
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
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">—</p>
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
              </>
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
                severity={
                  aiResult?.analysisSource === "ai-fallback"
                    ? (aiResult.severity as Severity)
                    : result.analysis.severity
                }
                payload={savePayload}
                sensitiveText={text}
              />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}