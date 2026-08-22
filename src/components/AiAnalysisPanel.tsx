"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  ErrorNote,
  Note,
  ResultBlock,
  SeverityBadge,
} from "@/components/ui";
import { SaveButton } from "@/components/SaveButton";
import { redactSensitiveValues } from "@/lib/llm/redact";
import type { Severity } from "@/types";
import type { AiAnalysis } from "@/lib/llm/schema";

/**
 * AI deep-analysis panel (Phase 3). Everything is opt-in: the user presses
 * "AI 深度分析", sees a privacy modal (model, outgoing size, redaction list)
 * and only then is the request sent. During the run a time-based progress
 * bar shows the model being called; results are labelled as unverified
 * hints (never overriding the rule engine) and can be saved to Support
 * History via SaveButton.
 */

interface AiStatus {
  enabled: boolean;
  model: string | null;
  modelLabel: string;
  timeoutMs: number;
}

interface AnalyzeData {
  analysis: AiAnalysis;
  maskedKeys: string[];
  cached: boolean;
  outgoingChars: number;
  durationMs?: number;
  provider?: string;
  model?: string | null;
}

function kb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function AiAnalysisPanel({
  log,
  ruleSeverity,
  system,
}: {
  log: string;
  ruleSeverity: Severity | null;
  system?: string;
}) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<AnalyzeData | null>(null);
  const [error, setError] = useState("");
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/ai/status")
      .then((res) => res.json())
      .then((json) => {
        if (json?.ok && json.data) setStatus(json.data as AiStatus);
        else setStatusError(json?.error ?? "AI status unavailable.");
      })
      .catch(() => setStatusError("AI status unavailable."));
  }, []);

  useEffect(() => {
    return () => {
      if (ticker.current) clearInterval(ticker.current);
    };
  }, []);

  // Client-side redaction preview (same pure function the server uses).
  const preview = log ? redactPreview(log) : null;

  const analyze = useCallback(async () => {
    setConfirmOpen(false);
    setLoading(true);
    setError("");
    setElapsed(0);
    ticker.current = setInterval(
      () => setElapsed((s) => s + 1),
      1000,
    );
    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ log }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        data?: AnalyzeData;
        error?: string;
      } | null;
      if (!res.ok || !json?.ok || !json.data) {
        setError(json?.error ?? "AI analysis failed.");
        return;
      }
      setResult(json.data);
    } catch {
      setError("AI analysis failed (network error).");
    } finally {
      if (ticker.current) clearInterval(ticker.current);
      ticker.current = null;
      setLoading(false);
    }
  }, [log]);

  if (!status) {
    return statusError ? (
      <Note>{statusError}</Note>
    ) : (
      <p className="text-sm text-zinc-400">Checking AI availability…</p>
    );
  }

  if (!status.enabled) {
    return (
      <Note>
        AI deep analysis is disabled. Set <code>PST_LLM_ENABLED=true</code> and
        install OpenCode (see Settings) to enable it.
      </Note>
    );
  }

  return (
    <Card
      title="AI Deep Analysis (OpenRouter)"
      description="Optional. Sends redacted log context to your configured model — never raw secrets, never automatic."
      actions={
        <Button
          variant="primary"
          size="sm"
          onClick={() => setConfirmOpen(true)}
          disabled={!log.trim() || loading}
        >
          {loading ? `Analysing… ${elapsed}s` : "AI 深度分析"}
        </Button>
      }
    >
      {confirmOpen && preview && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
          <p className="font-medium text-amber-800 dark:text-amber-300">
            隱私確認 — 呼叫模型 <code className="font-mono">{status.modelLabel}</code>
            ,將送出約 {kb(preview.outgoingChars)}
          </p>
          <ul className="mt-1 list-disc pl-5 text-amber-700 dark:text-amber-200">
            {preview.maskedKeys.length > 0 ? (
              <li>
                已自動遮蔽敏感值:
                {preview.maskedKeys.map((k) => `[${k}]`).join(" ")}
              </li>
            ) : (
              <li>未偵測到可遮蔽的敏感值(keyword 層面)</li>
            )}
          </ul>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" size="sm" onClick={() => void analyze()}>
              以遮蔽模式傳送
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
          </div>
        </div>
      )}

      {error && <ErrorNote message={error} />}

      {loading && <ProgressBar status={status} elapsed={elapsed} />}

      {result && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-zinc-400">
              AI 推測 severity(僅供參考,不覆寫規則結果):
            </span>
            <SeverityBadge severity={result.analysis.severity} />
            {ruleSeverity && (
              <span className="text-xs text-zinc-400">
                規則結果:{" "}
                <SeverityBadge severity={ruleSeverity} />
              </span>
            )}
            <span className="text-xs text-zinc-400">
              confidence {(result.analysis.confidence * 100).toFixed(0)}%
            </span>
          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-blue-500"
              style={{ width: `${Math.round(result.analysis.confidence * 100)}%` }}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ResultBlock title="AI Root Cause (推測)">
              <p className="px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200">
                {result.analysis.rootCauseZh}
              </p>
              {result.analysis.rootCause && (
                <details className="px-3 pb-1 text-xs text-zinc-500 dark:text-zinc-400">
                  <summary className="cursor-pointer select-none font-medium">EN</summary>
                  <p className="mt-1 whitespace-pre-wrap">{result.analysis.rootCause}</p>
                </details>
              )}
              {result.analysis.errorTypes.length > 0 && (
                <ul className="flex flex-wrap gap-1 px-3 pb-2">
                  {result.analysis.errorTypes.map((t) => (
                    <li
                      key={t}
                      className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                    >
                      {t}
                    </li>
                  ))}
                </ul>
              )}
            </ResultBlock>
            <ResultBlock title="Next Steps (推測)">
              <ol className="space-y-1 px-3 py-2">
                {result.analysis.nextStepsZh.map((step, i) => (
                  <li key={step} className="flex gap-2 text-sm text-zinc-800 dark:text-zinc-200">
                    <span className="font-mono text-xs text-zinc-400">{i + 1}.</span>
                    {step}
                  </li>
                ))}
              </ol>
              {result.analysis.nextSteps.length > 0 && (
                <details className="px-3 pb-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <summary className="cursor-pointer select-none font-medium">EN</summary>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-4">{result.analysis.nextSteps.map((s) => <li key={s}>{s}</li>)}</ol>
                </details>
              )}
            </ResultBlock>
          </div>

          {result.analysis.evidenceLines.length > 0 && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              AI 引用的證據行(請自行核實):{" "}
              {result.analysis.evidenceLines.map((n) => (
                <span
                  key={n}
                  className="mr-1 inline-block rounded bg-zinc-100 px-1 font-mono dark:bg-zinc-800"
                >
                  L{n}
                </span>
              ))}
            </p>
          )}

          {result.analysis.explanation && (
            <details className="text-sm text-zinc-600 dark:text-zinc-300">
              <summary className="cursor-pointer select-none">AI 推導過程</summary>
              <p className="mt-1 whitespace-pre-wrap">
                {result.analysis.explanationZh || result.analysis.explanation}
              </p>
              {result.analysis.explanationZh && (
                <p className="mt-2 whitespace-pre-wrap text-xs text-zinc-400 dark:text-zinc-500">
                  <span className="font-medium">EN:</span> {result.analysis.explanation}
                </p>
              )}
            </details>
          )}

          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
            {result.cached
              ? "來自本地快取(本次未有外送);"
              : `耗時 ${result.durationMs ?? "?"} ms;`}{" "}
            送出約 {kb(result.outgoingChars)};provider {result.provider ?? "opencode"} / 模型{" "}
            {result.model ?? status.modelLabel};遮蔽
            {result.maskedKeys.length > 0
              ? `: ${result.maskedKeys.join(", ")}`
              : "無(未偵測到敏感值)"}
          </p>

          <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <SaveButton
              tool="log-analyzer"
              system={system ?? ""}
              summary={aiSummary(result)}
              severity={result.analysis.severity}
              payload={JSON.stringify({
                input: log,
                system: system ?? "",
                aiAnalysis: result.analysis,
              })}
              sensitiveText={log}
              ai={result.analysis}
            />
          </div>
        </div>
      )}
    </Card>
  );
}

/** e.g. "AI (High, conf 72%): NullPointerException/HTTP Error in log" */
function aiSummary(result: AnalyzeData): string {
  const types = result.analysis.errorTypes.length
    ? result.analysis.errorTypes.join("/")
    : "log";
  return `AI (${result.analysis.severity}, conf ${(result.analysis.confidence * 100).toFixed(0)}%): ${types}`;
}

/** Time-based progress while the OpenCode agent runs (cap from status). */
function ProgressBar({ status, elapsed }: { status: AiStatus; elapsed: number }) {
  const capSec = Math.max(1, Math.round(status.timeoutMs / 1000));
  const pct = Math.min(100, Math.round((elapsed / capSec) * 100));
  return (
    <div className="space-y-1.5 py-2">
      <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <span>
          呼叫中: <code className="font-mono">{status.modelLabel}</code>
        </span>
        <span>
          已等待 {elapsed}s / 上限 {capSec}s
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-full rounded-full bg-blue-500 transition-[width] duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function redactPreview(log: string): { outgoingChars: number; maskedKeys: string[] } {
  // Pure client-side mirror of the server guard; masking only when enabled.
  const masked = redactSensitiveValues(log);
  return {
    outgoingChars: masked.text.length,
    maskedKeys: masked.maskedKeys,
  };
}