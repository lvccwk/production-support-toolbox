"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  ErrorNote,
  Input,
  SeverityBadge,
} from "@/components/ui";
import { TransferButtons } from "@/components/TransferButtons";
import { apiFetch, errorMessage } from "@/lib/api/client";
import type { HistoryEntry } from "@/types";

const TOOL_NAMES: Record<string, string> = {
  "log-analyzer": "Log Analyzer",
  "log-comparison": "Log Comparison",
  json: "JSON Toolbox",
  sql: "SQL Toolbox",
  timestamp: "Timestamp Converter",
  encoding: "Base64 / URL",
};

async function readJson<T>(res: Response): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const json = (await res.json()) as { ok: boolean; data?: T; error?: unknown };
    return { ok: json.ok, data: json.data, error: errorMessage(json) };
  } catch {
    return { ok: false, error: "Unexpected server response." };
  }
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function SupportHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async (search?: string) => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/history${search ? `?q=${encodeURIComponent(search)}` : ""}`);
      const json = await readJson<HistoryEntry[]>(res);
      if (json.ok && json.data) setEntries(json.data);
      else setError(json.error ?? "Failed to load history.");
    } catch {
      setError("Failed to load history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = async (id: number) => {
    try {
      const res = await apiFetch(`/api/history/${id}`, { method: "DELETE" });
      const json = await readJson(res);
      if (!json.ok) {
        setError(json.error ?? "Failed to delete entry.");
        return;
      }
      await refresh(query);
    } catch {
      setError("Failed to delete entry.");
    }
  };

  const reopen = (entry: HistoryEntry) => {
    let payload: unknown = null;
    try {
      payload = JSON.parse(entry.payload) as unknown;
    } catch {
      setError("This entry has an unreadable payload.");
      return;
    }
    window.dispatchEvent(
      new CustomEvent("pst:reopen", { detail: { tool: entry.tool, payload } }),
    );
  };

  return (
    <div className="space-y-4">
      <Card
        title="Saved Analyses"
        description="Only entries you explicitly saved appear here. Search, re-open or delete."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search history…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                void refresh(e.target.value);
              }}
              className="w-72"
            />
            <TransferButtons scope="history" onImported={() => void refresh(query)} />
          </div>
        }
      >
        {error && <div className="mb-3"><ErrorNote message={error} /></div>}
        {loading ? (
          <p className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">
            No saved analyses {query ? "match your search" : "yet"}.
            <span className="mt-1 block text-xs">
              Use &quot;Save Analysis&quot; inside a tool to store one here.
            </span>
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {entries.map((entry) => (
              <li key={entry.id} className="py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
                    {formatWhen(entry.createdAt)}
                  </span>
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {TOOL_NAMES[entry.tool] ?? entry.tool}
                  </span>
                  {entry.severity && <SeverityBadge severity={entry.severity} />}
                </div>
                <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {entry.summary}
                </p>
                {entry.system && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    System: {entry.system}
                  </p>
                )}
                <div className="mt-2 flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => reopen(entry)}>
                    Re-open
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      if (window.confirm("Delete this saved analysis?")) void remove(entry.id);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}