"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReopenRequest } from "@/components/AppShell";
import { SaveButton } from "@/components/SaveButton";
import {
  Button,
  Card,
  CopyButton,
  ErrorNote,
  Field,
  Input,
  Note,
  ResultBlock,
  SeverityBadge,
  TextArea,
  Toolbar,
} from "@/components/ui";
import { compareLogs } from "@/lib/log-comparison/comparator";
import type { ComparisonResult } from "@/lib/log-comparison/comparator";

const SAMPLE_BEFORE = `2026-08-21 10:00:00 INFO PaymentBatch completed 500 orders
HTTP 200`;

const SAMPLE_AFTER = `2026-08-21 10:15:22 ERROR PaymentBatch failed HTTP 500
java.lang.NullPointerException
\tat com.example.PaymentService.process(PaymentService.java:125)
Downstream payment API returned 503`;

function buildReport(result: ComparisonResult): string {
  const lines = [result.summary];
  if (result.newErrors.length > 0) {
    lines.push("", "New error:", ...result.newErrors.map((e) => `  - ${e}`));
  }
  if (result.missingErrors.length > 0) {
    lines.push("", "Missing (no longer present):", ...result.missingErrors.map((e) => `  - ${e}`));
  }
  for (const change of result.changedHttpStatuses) {
    lines.push("", `HTTP status changed: ${change.before ?? "—"} → ${change.after ?? "—"}`);
  }
  if (result.changedExceptionTypes.length > 0) {
    lines.push("", "Changed exception types:", ...result.changedExceptionTypes.map((e) => `  - ${e}`));
  }
  if (result.changedComponents.length > 0) {
    lines.push("", "Changed components:", ...result.changedComponents.map((e) => `  - ${e}`));
  }
  if (result.errorClusters.added.length > 0) {
    lines.push("", "New error kinds (cluster):");
    for (const c of result.errorClusters.added) {
      lines.push(`  + ${c.key} (${c.count} line${c.count === 1 ? "" : "s"})`);
      lines.push(`      e.g. ${c.sample}`);
    }
  }
  if (result.errorClusters.removed.length > 0) {
    lines.push("", "Gone error kinds (cluster):");
    for (const c of result.errorClusters.removed) {
      lines.push(`  - ${c.key} (${c.count} line${c.count === 1 ? "" : "s"})`);
    }
  }
  if (result.addedLines.length > 0) {
    lines.push("", "Added error lines:", ...result.addedLines.map((l) => `  + ${l}`));
  }
  if (result.removedLines.length > 0) {
    lines.push("", "Removed error lines:", ...result.removedLines.map((l) => `  - ${l}`));
  }
  return lines.join("\n");
}

export function LogComparison({ reopen }: { reopen?: ReopenRequest }) {
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const [system, setSystem] = useState("");
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (reopen && typeof reopen.payload === "object" && reopen.payload !== null) {
      const payload = reopen.payload as { before?: string; after?: string; system?: string };
      if (typeof payload.before === "string") setBefore(payload.before);
      if (typeof payload.after === "string") setAfter(payload.after);
      if (typeof payload.system === "string") setSystem(payload.system);
      if (typeof payload.before === "string" && typeof payload.after === "string") {
        try {
          setResult(compareLogs(payload.before, payload.after));
          setError("");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Comparison failed.");
          setResult(null);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reopen?.key]);

  const compare = () => {
    try {
      setResult(compareLogs(before, after));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comparison failed.");
      setResult(null);
    }
  };

  const summary = useMemo(() => {
    if (!result) return "";
    const head = result.newErrors[0] ?? result.changedHttpStatuses[0]?.after?.toString() ?? "log";
    return `${result.summary} ${head}`.trim();
  }, [result]);

  return (
    <div className="space-y-4">
      <Card
        title="Logs"
        description="Paste the log from before and after a change to highlight new errors, changed status codes, components and messages."
        actions={
          <Button variant="primary" onClick={compare} disabled={!before.trim() || !after.trim()}>
            Compare Logs
          </Button>
        }
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Before">
            <TextArea
              mono
              rows={12}
              value={before}
              onChange={(e) => setBefore(e.target.value)}
              placeholder="Paste the 'before' log here…"
            />
          </Field>
          <Field label="After">
            <TextArea
              mono
              rows={12}
              value={after}
              onChange={(e) => setAfter(e.target.value)}
              placeholder="Paste the 'after' log here…"
            />
          </Field>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <Toolbar
            onClear={() => {
              setBefore("");
              setAfter("");
              setResult(null);
              setError("");
            }}
            clearDisabled={!before && !after && !result}
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setBefore(SAMPLE_BEFORE);
                setAfter(SAMPLE_AFTER);
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
        <Card title="Comparison Result">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">Severity</span>
            <SeverityBadge severity={result.severityBefore} />
            <span className="text-zinc-400">→</span>
            <SeverityBadge severity={result.severityAfter} />
            <Note tone={result.regression ? "warn" : "ok"}>{result.summary}</Note>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <ResultBlock title="New Errors">
              {result.newErrors.length > 0 ? (
                <ul className="space-y-1 px-3 py-2">
                  {result.newErrors.map((e) => (
                    <li key={e} className="font-mono text-[13px] text-red-700 dark:text-red-300">
                      {e}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">None</p>
              )}
            </ResultBlock>
            <ResultBlock title="Missing Errors">
              {result.missingErrors.length > 0 ? (
                <ul className="space-y-1 px-3 py-2">
                  {result.missingErrors.map((e) => (
                    <li key={e} className="font-mono text-[13px] text-emerald-700 dark:text-emerald-300">
                      {e}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">None</p>
              )}
            </ResultBlock>
          </div>

          {result.changedHttpStatuses.length > 0 && (
            <div className="mt-4">
              <ResultBlock title="Changed HTTP Codes">
                <ul className="space-y-1 px-3 py-2">
                  {result.changedHttpStatuses.map((change, i) => (
                    <li key={i} className="font-mono text-[13px] text-zinc-800 dark:text-zinc-200">
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {change.before ?? "—"}
                      </span>{" "}
                      →{" "}
                      <span
                        className={
                          change.after !== null && change.after >= 400
                            ? "text-red-600 dark:text-red-400"
                            : "text-zinc-800 dark:text-zinc-200"
                        }
                      >
                        {change.after ?? "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </ResultBlock>
            </div>
          )}

          {(result.changedExceptionTypes.length > 0 ||
            result.changedComponents.length > 0) && (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {result.changedExceptionTypes.length > 0 && (
                <ResultBlock title="Changed Exception Types">
                  <ul className="space-y-1 px-3 py-2">
                    {result.changedExceptionTypes.map((e) => (
                      <li key={e} className="font-mono text-[13px] text-zinc-800 dark:text-zinc-200">
                        {e}
                      </li>
                    ))}
                  </ul>
                </ResultBlock>
              )}
              {result.changedComponents.length > 0 && (
                <ResultBlock title="Changed Components">
                  <ul className="space-y-1 px-3 py-2">
                    {result.changedComponents.map((c) => (
                      <li key={c} className="font-mono text-[13px] text-zinc-800 dark:text-zinc-200">
                        {c}
                      </li>
                    ))}
                  </ul>
                </ResultBlock>
              )}
            </div>
          )}

          {(result.errorClusters.added.length > 0 ||
            result.errorClusters.removed.length > 0) && (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <ResultBlock title="New Error Kinds (cluster)">
                {result.errorClusters.added.length > 0 ? (
                  <ul className="space-y-2 px-3 py-2">
                    {result.errorClusters.added.map((c) => (
                      <li key={c.key} className="text-sm text-zinc-800 dark:text-zinc-200">
                        <span className="font-mono text-[13px] font-medium text-red-700 dark:text-red-300">
                          + {c.key}
                        </span>
                        <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">
                          {c.count} line{c.count === 1 ? "" : "s"}
                        </span>
                        <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                          {c.sample}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">None</p>
                )}
              </ResultBlock>
              <ResultBlock title="Gone Error Kinds (cluster)">
                {result.errorClusters.removed.length > 0 ? (
                  <ul className="space-y-2 px-3 py-2">
                    {result.errorClusters.removed.map((c) => (
                      <li key={c.key} className="text-sm text-zinc-800 dark:text-zinc-200">
                        <span className="font-mono text-[13px] font-medium text-emerald-700 dark:text-emerald-300">
                          − {c.key}
                        </span>
                        <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">
                          {c.count} line{c.count === 1 ? "" : "s"}
                        </span>
                        <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                          {c.sample}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">None</p>
                )}
              </ResultBlock>
            </div>
          )}

          {result.addedLines.length > 0 && (
            <div className="mt-4">
              <ResultBlock title="Added Lines (error-like, noise-filtered)">
                <pre className="overflow-x-auto px-3 py-2 font-mono text-[12px] leading-relaxed text-red-700 dark:text-red-300">
                  {result.addedLines.join("\n")}
                </pre>
              </ResultBlock>
            </div>
          )}
        </Card>
      )}

      {result && (
        <Card title="Save Analysis" description="Stored only when you click Save.">
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
              tool="log-comparison"
              system={system}
              summary={summary}
              severity={result.severityAfter}
              payload={JSON.stringify({ before, after, system })}
              sensitiveText={`${before}\n${after}`}
            />
          </div>
        </Card>
      )}
    </div>
  );
}