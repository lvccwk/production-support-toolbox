"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReopenRequest } from "@/components/AppShell";
import { SaveButton } from "@/components/SaveButton";
import {
  Button,
  Card,
  CopyButton,
  ErrorNote,
  Input,
  ResultBlock,
  TextArea,
  Toolbar,
} from "@/components/ui";
import { formatJson, minifyJson, searchJson, validateJson } from "@/lib/json/jsonTools";
import { toToolError } from "@/lib/errors";
import type { JsonSearchHit } from "@/types";

type Mode = "format" | "validate" | "minify" | "search";
const SAMPLE = '{"transactionId":"ABC123","status":"ERROR","errorCode":"E42","nested":{"status":"OK"}}';

export function JsonToolbox({ reopen }: { reopen?: ReopenRequest }) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("format");
  const [query, setQuery] = useState("");
  const [output, setOutput] = useState("");
  const [hits, setHits] = useState<JsonSearchHit[]>([]);
  const [validation, setValidation] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (reopen && typeof reopen.payload === "object" && reopen.payload !== null) {
      const payload = reopen.payload as { input?: string; mode?: Mode };
      if (typeof payload.input === "string") {
        setInput(payload.input);
        if (payload.mode === "search" || payload.mode === "format" || payload.mode === "minify" || payload.mode === "validate") {
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
    setHits([]);
    setValidation(null);
    try {
      if (mode === "validate") {
        const r = validateJson(input);
        setValidation(r.valid ? "Valid JSON ✓" : r.error ?? "Invalid JSON.");
        if (!r.valid) setError("Invalid JSON. Please check syntax.");
      } else if (mode === "search") {
        setHits(searchJson(input, query));
      } else if (mode === "minify") {
        setOutput(minifyJson(input));
      } else {
        setOutput(formatJson(input));
      }
    } catch (err) {
      setError(toToolError(err).message);
    }
  };

  const summary = useMemo(() => {
    const key = mode === "search" ? `search "${query}"` : mode;
    return `JSON ${key} on ${input.length} chars`;
  }, [mode, query, input.length]);

  const resultText = output || validation || "";

  return (
    <div className="space-y-4">
      <Card
        title="Input"
        description="Paste JSON, then choose an operation."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              aria-label="Operation"
            >
              <option value="format">Format</option>
              <option value="validate">Validate</option>
              <option value="minify">Minify</option>
              <option value="search">Search</option>
            </select>
            {mode === "search" && (
              <Input
                placeholder="Key or value, e.g. transactionId"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-56"
              />
            )}
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
          placeholder='{"name":"ABC","status":"ERROR"}'
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <Toolbar
            onClear={() => {
              setInput("");
              setOutput("");
              setHits([]);
              setError("");
              setValidation(null);
            }}
            clearDisabled={!input && !output && !hits.length}
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
            {resultText && <CopyButton text={resultText} />}
            {hits.length > 0 && (
              <CopyButton text={JSON.stringify(hits, null, 2)} label="Copy results" />
            )}
          </Toolbar>
          {error && <ErrorNote message={error} />}
        </div>
      </Card>

      {validation && (
        <ResultBlock title="Validation Result">
          <p
            className={`px-3 py-2 font-mono text-[13px] ${
              validation.startsWith("Valid")
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-red-700 dark:text-red-300"
            }`}
          >
            {validation}
          </p>
        </ResultBlock>
      )}

      {output && (
        <ResultBlock title={`Output — ${mode === "minify" ? "one line" : "formatted"}`}>
          <pre className="max-h-96 overflow-auto px-3 py-2 font-mono text-[12.5px] leading-relaxed text-zinc-800 dark:text-zinc-200">
            {output}
          </pre>
        </ResultBlock>
      )}

      {hits.length > 0 && (
        <div className="space-y-2">
          <ResultBlock title={`Search Results (${hits.length})`}>
            <ul className="divide-y divide-zinc-100 px-1 dark:divide-zinc-800">
              {hits.map((hit) => (
                <li key={`${hit.path}-${JSON.stringify(hit.value)}`} className="px-2 py-1.5">
                  <p className="font-mono text-[12px] text-blue-700 dark:text-blue-300">{hit.path}</p>
                  <pre className="mt-0.5 overflow-x-auto font-mono text-[12px] text-zinc-800 dark:text-zinc-200">
                    {typeof hit.value === "string" ? hit.value : JSON.stringify(hit.value)}
                  </pre>
                </li>
              ))}
            </ul>
          </ResultBlock>
        </div>
      )}

      {hits.length === 0 && mode === "search" && input.trim() && !error && (
        <ResultBlock title="Search Results">
          <p className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">
            No matches for “{query}”.
          </p>
        </ResultBlock>
      )}

      {!error && (output || validation || hits.length > 0 || (mode === "search" && input.trim())) && (
        <Card title="Save Analysis" description="Stored only when you click Save.">
          <SaveButton
            tool="json"
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