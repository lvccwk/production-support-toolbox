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
  Toolbar,
} from "@/components/ui";
import { cronHelper } from "@/lib/cron/parser";
import { toToolError } from "@/lib/errors";
import type { CronDescription } from "@/types";

export function CronHelper({ reopen }: { reopen?: ReopenRequest }) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<CronDescription | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (reopen && typeof reopen.payload === "object" && reopen.payload !== null) {
      const payload = reopen.payload as { input?: string };
      if (typeof payload.input === "string") {
        setInput(payload.input);
        try {
          setResult(cronHelper(payload.input));
          setError("");
        } catch (err) {
          setError(toToolError(err).message);
          setResult(null);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reopen?.key]);

  const run = () => {
    try {
      setResult(cronHelper(input));
      setError("");
    } catch (err) {
      setResult(null);
      setError(toToolError(err).message);
    }
  };

  const summary = useMemo(
    () => (result ? `cron ${input} — ${result.human}` : ""),
    [result, input],
  );

  return (
    <div className="space-y-4">
      <Card
        title="Cron Expression"
        description="Standard 5-field cron: minute hour day-of-month month day-of-week (0 8 * * * = every day at 08:00)."
        actions={
          <Toolbar
            onClear={() => { setInput(""); setResult(null); setError(""); }}
            clearDisabled={!input && !result}
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setInput("0 8 * * *");
                setResult(null);
                setError("");
              }}
            >
              Insert sample
            </Button>
            <Button variant="primary" onClick={run} disabled={!input.trim()}>
              Explain
            </Button>
          </Toolbar>
        }
      >
        <Field label="Expression">
          <Input
            mono
            placeholder="0 8 * * *"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="max-w-sm font-mono"
          />
        </Field>
        {error && <div className="mt-3"><ErrorNote message={error} /></div>}
      </Card>

      {result && (
        <Card
          title="Schedule"
          actions={<CopyButton text={JSON.stringify(result, null, 2)} label="Copy all" />}
        >
          <Note tone="ok">
            <span className="font-mono">{result.expression}</span>
            <span className="ml-2 font-semibold">{result.human}</span>
          </Note>

          <div className="mt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Next 5 execution times
            </p>
            <ol className="space-y-1">
              {result.nextRuns.map((run, i) => (
                <li
                  key={run}
                  className="flex items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 font-mono text-[13px] text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-200"
                >
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">#{i + 1}</span>
                  <span className="flex-1">{run}</span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">local time</span>
                </li>
              ))}
              {result.nextRuns.length === 0 && (
                <li className="text-sm text-zinc-400 dark:text-zinc-500">
                  No upcoming runs found in the scan window.
                </li>
              )}
            </ol>
          </div>
        </Card>
      )}

      {result && (
        <Card title="Save Analysis" description="Stored only when you click Save.">
          <SaveButton
            tool="cron"
            system=""
            summary={summary}
            severity={null}
            payload={JSON.stringify({ input })}
            sensitiveText=""
          />
        </Card>
      )}
    </div>
  );
}