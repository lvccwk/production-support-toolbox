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
  Select,
  Toolbar,
} from "@/components/ui";
import {
  availableTimezones,
  convertTimestamp,
  DEFAULT_TIMEZONE,
  nowUnixSeconds,
} from "@/lib/timestamp/converter";
import { toToolError } from "@/lib/errors";
import type { TimestampResult } from "@/lib/timestamp/converter";

export function TimestampConverter({ reopen }: { reopen?: ReopenRequest }) {
  const [input, setInput] = useState("");
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [result, setResult] = useState<TimestampResult | null>(null);
  const [error, setError] = useState("");

  const zones = useMemo(() => availableTimezones(), []);

  useEffect(() => {
    if (reopen && typeof reopen.payload === "object" && reopen.payload !== null) {
      const payload = reopen.payload as { input?: string; timezone?: string };
      if (typeof payload.input === "string") setInput(payload.input);
      if (typeof payload.timezone === "string" && zones.includes(payload.timezone)) {
        setTimezone(payload.timezone);
      }
      if (typeof payload.input === "string") {
        try {
          setResult(convertTimestamp(payload.input, payload.timezone ?? DEFAULT_TIMEZONE));
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
      setResult(convertTimestamp(input, timezone));
      setError("");
    } catch (err) {
      setResult(null);
      setError(toToolError(err).message);
    }
  };

  const summary = useMemo(
    () => (result ? `${input} → ${result.local} (${timezone})` : ""),
    [result, input, timezone],
  );

  return (
    <div className="space-y-4">
      <Card
        title="Input"
        description="Unix seconds / milliseconds, ISO 8601, or YYYY-MM-DD HH:mm:ss (interpreted in the selected timezone)."
        actions={
          <Toolbar onClear={() => { setInput(""); setResult(null); setError(""); }} clearDisabled={!input && !result}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setInput(String(nowUnixSeconds()))}
              title="Insert current Unix time"
            >
              Now
            </Button>
            <Button variant="primary" onClick={run} disabled={!input.trim()}>
              Convert
            </Button>
          </Toolbar>
        }
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_260px]">
          <Field label="Timestamp">
            <Input
              mono
              placeholder="1787299200 or 2026-08-21 16:00:00 or 2026-08-21T08:00:00Z"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </Field>
          <Field label="Timezone">
            <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {error && <div className="mt-3"><ErrorNote message={error} /></div>}
      </Card>

      {result && (
        <Card
          title="Converted"
          actions={<CopyButton text={JSON.stringify(result, null, 2)} label="Copy all" />}
        >
          <DefinitionList
            items={[
              ["Unix (seconds)", result.unixSeconds],
              ["Unix (milliseconds)", result.unixMilliseconds],
              ["ISO 8601", result.iso8601],
              ["Local", `${result.local} (${result.timezone})`],
              ["UTC", result.utc],
              ["Parsed as", result.parsedAs],
            ]}
          />
        </Card>
      )}

      {result && (
        <Card title="Save Analysis" description="Stored only when you click Save.">
          <SaveButton
            tool="timestamp"
            system=""
            summary={summary}
            severity={null}
            payload={JSON.stringify({ input, timezone })}
            sensitiveText=""
          />
        </Card>
      )}
    </div>
  );
}