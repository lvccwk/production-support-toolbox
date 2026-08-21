"use client";

import { useMemo, useState } from "react";
import {
  Card,
  CopyButton,
  Input,
  ResultBlock,
  Toolbar,
} from "@/components/ui";
import { HTTP_STATUS_CATALOG, searchHttpStatus } from "@/lib/http/statusCatalog";
import type { HttpStatusEntry } from "@/types";

/** Category colour used in the status rows. */
function categoryTone(category: HttpStatusEntry["category"]): string {
  switch (category) {
    case "2xx":
      return "text-emerald-600 dark:text-emerald-400";
    case "3xx":
      return "text-sky-600 dark:text-sky-400";
    case "4xx":
      return "text-amber-600 dark:text-amber-400";
    case "5xx":
      return "text-red-600 dark:text-red-400";
    default:
      return "text-zinc-500 dark:text-zinc-400";
  }
}

export function HttpStatusHelper() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<HttpStatusEntry | null>(null);

  const results = useMemo(() => searchHttpStatus(query), [query]);

  return (
    <div className="space-y-4">
      <Card
        title="Search"
        description="Search by code (e.g. 503) or text (e.g. gateway timeout)."
        actions={
          <Toolbar onClear={() => { setQuery(""); setSelected(null); }} clearDisabled={!query && !selected}>
            <Input
              placeholder="Code or keyword…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(null);
              }}
              className="w-64"
            />
          </Toolbar>
        }
      >
        <div className="max-h-72 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-zinc-50 text-[11px] uppercase tracking-wider text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2 font-semibold">Code</th>
                <th className="px-3 py-2 font-semibold">Phrase</th>
                <th className="hidden px-3 py-2 font-semibold sm:table-cell">Meaning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {results.map((entry) => (
                <tr
                  key={entry.code}
                  onClick={() => setSelected(entry)}
                  className={`cursor-pointer transition-colors ${
                    selected?.code === entry.code
                      ? "bg-blue-50 dark:bg-blue-950/40"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  }`}
                >
                  <td className={`px-3 py-1.5 font-mono font-semibold ${categoryTone(entry.category)}`}>
                    {entry.code}
                  </td>
                  <td className="px-3 py-1.5 text-zinc-800 dark:text-zinc-200">{entry.phrase}</td>
                  <td className="hidden px-3 py-1.5 text-zinc-500 dark:text-zinc-400 sm:table-cell">
                    {entry.meaning}
                  </td>
                </tr>
              ))}
              {results.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-sm text-zinc-400 dark:text-zinc-500">
                    No status codes match “{query}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {selected && (
        <Card
          title={
            <>
              {selected.code} {selected.phrase}
            </>
          }
          actions={<CopyButton text={JSON.stringify(selected, null, 2)} label="Copy entry" />}
        >
          <p className="text-sm text-zinc-700 dark:text-zinc-300">{selected.meaning}</p>

          {selected.commonCauses.length > 0 && (
            <div className="mt-4">
              <ResultBlock title="Common Production Cause">
                <ul className="space-y-1 px-3 py-2">
                  {selected.commonCauses.map((cause) => (
                    <li key={cause} className="flex gap-2 text-sm text-zinc-800 dark:text-zinc-200">
                      <span className="text-amber-600 dark:text-amber-400">•</span>
                      {cause}
                    </li>
                  ))}
                </ul>
              </ResultBlock>
            </div>
          )}

          {selected.whatToCheck.length > 0 && (
            <div className="mt-4">
              <ResultBlock title="What To Check">
                <ul className="space-y-1 px-3 py-2">
                  {selected.whatToCheck.map((check) => (
                    <li key={check} className="flex gap-2 text-sm text-zinc-800 dark:text-zinc-200">
                      <span className="text-blue-600 dark:text-blue-400">•</span>
                      {check}
                    </li>
                  ))}
                </ul>
              </ResultBlock>
            </div>
          )}

          <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
            {HTTP_STATUS_CATALOG.length} codes in reference — all data is local.
          </p>
        </Card>
      )}
    </div>
  );
}