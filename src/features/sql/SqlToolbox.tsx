"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReopenRequest } from "@/components/AppShell";
import { SaveButton } from "@/components/SaveButton";
import {
  Button,
  Card,
  CopyButton,
  ErrorNote,
  Note,
  ResultBlock,
  TextArea,
  Toolbar,
} from "@/components/ui";
import { formatSql } from "@/lib/sql/sqlFormatter";
import { checkSqlSafety } from "@/lib/sql/sqlSafety";
import { analyzeSql } from "@/lib/sql/sqlAnalyzer";
import { toToolError } from "@/lib/errors";
import type { SqlSafetyIssue } from "@/types";

type Mode = "format" | "safety" | "analyze";
const SAMPLE = `UPDATE customer SET status = 'X';
DELETE FROM audit_log;
SELECT c.name, o.total FROM customer c LEFT JOIN orders o ON c.id = o.customer_id WHERE o.total > 100 ORDER BY o.total DESC LIMIT 10;`;

function safetyTone(issue: SqlSafetyIssue): "warn" | "ok" | "info" {
  if (issue.severity === "critical") return "warn";
  if (issue.severity === "warning") return "info";
  return "ok";
}

export function SqlToolbox({ reopen }: { reopen?: ReopenRequest }) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("format");
  const [output, setOutput] = useState("");
  const [issues, setIssues] = useState<SqlSafetyIssue[]>([]);
  const [analysis, setAnalysis] = useState<ReturnType<typeof analyzeSql> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (reopen && typeof reopen.payload === "object" && reopen.payload !== null) {
      const payload = reopen.payload as { input?: string; mode?: Mode };
      if (typeof payload.input === "string") {
        setInput(payload.input);
        if (payload.mode === "format" || payload.mode === "safety" || payload.mode === "analyze") {
          setMode(payload.mode);
        }
        setError("");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reopen?.key]);

  const run = () => {
    setError("");
    setOutput("");
    setIssues([]);
    setAnalysis(null);
    try {
      if (mode === "format") setOutput(formatSql(input));
      else if (mode === "safety") setIssues(checkSqlSafety(input).issues);
      else setAnalysis(analyzeSql(input));
    } catch (err) {
      setError(toToolError(err).message);
    }
  };

  const summary = useMemo(() => {
    const count = mode === "safety" ? issues.length : 0;
    return `SQL ${mode} (${count} finding${count === 1 ? "" : "s"})`;
  }, [mode, issues.length]);

  return (
    <div className="space-y-4">
      <Card
        title="Input"
        description="Text-only SQL tools. This app never connects to or executes anything against real databases."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              aria-label="Operation"
            >
              <option value="format">Format</option>
              <option value="safety">Safety Check</option>
              <option value="analyze">Basic Analysis</option>
            </select>
            <Button variant="primary" onClick={run} disabled={!input.trim()}>
              Run
            </Button>
          </div>
        }
      >
        <TextArea
          mono
          rows={12}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste SQL here… e.g. select a,b,c from customer where status='A' order by created_date;"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <Toolbar
            onClear={() => {
              setInput("");
              setOutput("");
              setIssues([]);
              setAnalysis(null);
              setError("");
            }}
            clearDisabled={!input && !output && !issues.length && !analysis}
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setInput(SAMPLE);
                setError("");
              }}
            >
              Insert sample
            </Button>
            {output && <CopyButton text={output} />}
            {issues.length > 0 && (
              <CopyButton
                text={issues
                  .map((i) => `[${i.severity.toUpperCase()}] ${i.message}\n${i.statement}`)
                  .join("\n\n")}
                label="Copy findings"
              />
            )}
          </Toolbar>
          {error && <ErrorNote message={error} />}
        </div>
      </Card>

      {output && (
        <ResultBlock title="Formatted SQL">
          <pre className="max-h-96 overflow-auto px-3 py-2 font-mono text-[12.5px] leading-relaxed text-zinc-800 dark:text-zinc-200">
            {output}
          </pre>
        </ResultBlock>
      )}

      {mode === "safety" && input.trim() && !error && (
        <div className="space-y-2">
          {issues.length === 0 ? (
            <Note tone="ok">No dangerous statements detected.</Note>
          ) : (
            issues.map((issue) => (
              <Note key={`${issue.code}-${issue.statement}`} tone={safetyTone(issue)}>
                <span className="font-semibold">
                  {issue.severity === "critical" ? "WARNING" : issue.severity === "warning" ? "CAUTION" : "INFO"}
                </span>
                <span className="ml-1 font-mono text-[11px] opacity-70">[{issue.code}]</span>
                <p className="mt-1">{issue.message}</p>
                <pre className="mt-1 overflow-x-auto font-mono text-[11.5px] opacity-80">
                  {issue.statement}
                </pre>
              </Note>
            ))
          )}
        </div>
      )}

      {analysis && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ResultBlock title="Statement">
            <p className="px-3 py-2 font-mono text-[13px] text-zinc-800 dark:text-zinc-200">
              {analysis.statementType}
            </p>
          </ResultBlock>
          <ResultBlock title="Tables">
            <ul className="space-y-0.5 px-3 py-2">
              {analysis.tables.length > 0 ? (
                analysis.tables.map((t) => (
                  <li key={t} className="font-mono text-[13px] text-zinc-800 dark:text-zinc-200">
                    {t}
                  </li>
                ))
              ) : (
                <li className="text-sm text-zinc-500 dark:text-zinc-400">—</li>
              )}
            </ul>
          </ResultBlock>
          <ResultBlock title="Clauses">
            <ul className="space-y-1 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200">
              <li>WHERE: {analysis.hasWhere ? "present" : "absent"}</li>
              <li>JOIN: {analysis.joins.length > 0 ? analysis.joins.join(", ") : "none"}</li>
              <li>ORDER BY: {analysis.orderBy.length > 0 ? analysis.orderBy.join(", ") : "none"}</li>
              <li>GROUP BY: {analysis.groupBy.length > 0 ? analysis.groupBy.join(", ") : "none"}</li>
              <li>LIMIT: {analysis.hasLimit ? "present" : "absent"}</li>
              <li>Bind parameters (?): {analysis.parameterCount}</li>
            </ul>
          </ResultBlock>
        </div>
      )}

      {!error && (output || issues.length > 0 || analysis) && (
        <Card title="Save Analysis" description="Stored only when you click Save.">
          <SaveButton
            tool="sql"
            system=""
            summary={summary}
            severity={null}
            payload={JSON.stringify({ input, mode })}
            sensitiveText={input}
          />
        </Card>
      )}
    </div>
  );
}