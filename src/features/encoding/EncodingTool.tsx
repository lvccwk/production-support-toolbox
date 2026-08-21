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
  Select,
  TextArea,
  Toolbar,
} from "@/components/ui";
import {
  base64Decode,
  base64Encode,
  urlDecode,
  urlEncode,
} from "@/lib/encoding/tools";
import { toToolError } from "@/lib/errors";

type Operation =
  | "base64-encode"
  | "base64-decode"
  | "url-encode"
  | "url-decode";

const SAMPLE = "hello world";

export function EncodingTool({ reopen }: { reopen?: ReopenRequest }) {
  const [input, setInput] = useState("");
  const [operation, setOperation] = useState<Operation>("base64-encode");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (reopen && typeof reopen.payload === "object" && reopen.payload !== null) {
      const payload = reopen.payload as { input?: string; operation?: Operation };
      if (typeof payload.input === "string") setInput(payload.input);
      if (
        payload.operation === "base64-encode" ||
        payload.operation === "base64-decode" ||
        payload.operation === "url-encode" ||
        payload.operation === "url-decode"
      ) {
        setOperation(payload.operation);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reopen?.key]);

  const run = () => {
    setError("");
    try {
      switch (operation) {
        case "base64-encode":
          setOutput(base64Encode(input));
          break;
        case "base64-decode":
          setOutput(base64Decode(input));
          break;
        case "url-encode":
          setOutput(urlEncode(input));
          break;
        case "url-decode":
          setOutput(urlDecode(input));
          break;
      }
    } catch (err) {
      setOutput("");
      setError(toToolError(err).message);
    }
  };

  const summary = useMemo(
    () => `${operation} of ${input.length} chars`,
    [operation, input.length],
  );

  return (
    <div className="space-y-4">
      <Card
        title="Input"
        description="hello world → hello%20world (URL encode). UTF-8 safe base64."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={operation}
              onChange={(e) => setOperation(e.target.value as Operation)}
              aria-label="Operation"
            >
              <option value="base64-encode">Base64 Encode</option>
              <option value="base64-decode">Base64 Decode</option>
              <option value="url-encode">URL Encode</option>
              <option value="url-decode">URL Decode</option>
            </Select>
            <Button variant="primary" onClick={run} disabled={!input}>
              Run
            </Button>
          </div>
        }
      >
        <Field label="Text">
          <TextArea
            mono
            rows={8}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste text here…"
          />
        </Field>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <Toolbar
            onClear={() => {
              setInput("");
              setOutput("");
              setError("");
            }}
            clearDisabled={!input && !output}
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
          </Toolbar>
          {error && <ErrorNote message={error} />}
        </div>
      </Card>

      {output && (
        <Card
          title={`Result — ${operation.replace("-", " ")}`}
          actions={<CopyButton text={output} />}
        >
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all font-mono text-[13px] leading-relaxed text-zinc-800 dark:text-zinc-200">
            {output}
          </pre>
        </Card>
      )}

      {output && (
        <Card title="Save Analysis" description="Stored only when you click Save.">
          <SaveButton
            tool="encoding"
            system=""
            summary={summary}
            severity={null}
            payload={JSON.stringify({ input, operation })}
            sensitiveText={input}
          />
        </Card>
      )}
    </div>
  );
}