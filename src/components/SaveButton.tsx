"use client";

import { useMemo, useState } from "react";
import { Button, Note } from "@/components/ui";
import { detectSensitiveData } from "@/lib/sensitive/detector";
import type { AiAnalysis, Severity } from "@/types";

/**
 * "Save Analysis" button (sections 15 & 17). Saves PER EXPLICIT CLICK only —
 * never automatic. Warns when the content looks sensitive.
 */

export function SaveButton({
  tool,
  system,
  summary,
  severity,
  payload,
  sensitiveText,
  disabled = false,
  onSaved,
  ai,
}: {
  tool: string;
  system: string;
  summary: string;
  severity: Severity | null;
  payload: string;
  /** Raw text that should be scanned for sensitive content before saving. */
  sensitiveText: string;
  disabled?: boolean;
  onSaved?: () => void;
  /** Optional structured AI analysis to store/export alongside the entry. */
  ai?: AiAnalysis | null;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  const sensitive = useMemo(
    () => (sensitiveText ? detectSensitiveData(sensitiveText) : null),
    [sensitiveText],
  );

  async function save() {
    setState("saving");
    try {
      const res = await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, system, summary, severity, payload, ai }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to save analysis.");
      setState("saved");
      setMessage("Saved to Support History.");
      onSaved?.();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Failed to save analysis.");
    }
  }

  return (
    <div className="space-y-2">
      {state !== "saved" && (
        <Button variant="primary" size="sm" onClick={save} disabled={disabled || state === "saving"}>
          {state === "saving" ? "Saving…" : "Save Analysis"}
        </Button>
      )}
      {state === "saved" && <Note tone="ok">{message} You can re-open it from Support History.</Note>}
      {state === "error" && <Note tone="warn">{message}</Note>}
      {state !== "saved" && sensitive?.found && (
        <Note tone="warn">
          <span className="font-semibold">Potential sensitive information detected.</span>{" "}
          Review the content before saving. (Matched: {sensitive.matchedKeys.join(", ")})
        </Note>
      )}
    </div>
  );
}