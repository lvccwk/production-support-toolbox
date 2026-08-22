"use client";

import { useRef, useState } from "react";
import { Button, ErrorNote, Note } from "@/components/ui";

interface ImportResult {
  importedIncidents: number;
  importedHistory: number;
  skipped: number;
}

/**
 * Export / import controls shared by the incident and history pages.
 * - Export JSON: full backup bundle (both tables, schema-versioned).
 * - Export CSV: flat export of the current scope, Excel-friendly.
 * - Import: restore a backup JSON (duplicates skipped).
 */
export function TransferButtons({
  scope,
  onImported,
}: {
  scope: "incidents" | "history";
  onImported?: () => void;
}) {
  const [notice, setNotice] = useState("");
  const [fileError, setFileError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const stamp = () => new Date().toISOString().slice(0, 10);

  const download = async (url: string, fallback: string) => {
    setFileError("");
    setNotice("");
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setFileError(body?.error ?? "Export failed.");
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = match?.[1] ?? fallback;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      setFileError("Export failed.");
    }
  };

  const importFile = async (file: File) => {
    setFileError("");
    setNotice("");
    try {
      const text = await file.text();
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: text }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        data?: ImportResult;
        error?: string;
      } | null;
      if (!res.ok || !json?.ok) {
        setFileError(json?.error ?? "Import failed.");
        return;
      }
      const r = json.data;
      if (!r) {
        setFileError("Import failed: missing result.");
        return;
      }
      setNotice(
        `Imported ${r.importedIncidents} incident(s) and ${r.importedHistory} history entr(y/ies); ${r.skipped} duplicate(s) skipped.`,
      );
      onImported?.();
    } catch {
      setFileError("Import failed.");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void download("/api/export?format=json", `pst-backup-${stamp()}.json`)}
      >
        Export JSON
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() =>
          void download(`/api/export?format=csv&kind=${scope}`, `pst-${scope}-${stamp()}.csv`)
        }
      >
        Export CSV
      </Button>
      <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
        Import
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
          e.target.value = "";
        }}
      />
      {notice && <Note tone="ok">{notice}</Note>}
      {fileError && <ErrorNote message={fileError} />}
    </div>
  );
}