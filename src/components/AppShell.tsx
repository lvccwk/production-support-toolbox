"use client";

import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { SeverityBadge } from "@/components/ui";

const LogAnalyzer = lazy(() =>
  import("@/features/log-analyzer/LogAnalyzer").then((m) => ({ default: m.LogAnalyzer })),
);
const LogComparison = lazy(() =>
  import("@/features/log-comparison/LogComparison").then((m) => ({ default: m.LogComparison })),
);
const JsonToolbox = lazy(() =>
  import("@/features/json/JsonToolbox").then((m) => ({ default: m.JsonToolbox })),
);
const SqlToolbox = lazy(() =>
  import("@/features/sql/SqlToolbox").then((m) => ({ default: m.SqlToolbox })),
);
const TimestampConverter = lazy(() =>
  import("@/features/timestamp/TimestampConverter").then((m) => ({
    default: m.TimestampConverter,
  })),
);
const HttpStatusHelper = lazy(() =>
  import("@/features/http/HttpStatusHelper").then((m) => ({ default: m.HttpStatusHelper })),
);
const EncodingTool = lazy(() =>
  import("@/features/encoding/EncodingTool").then((m) => ({ default: m.EncodingTool })),
);
const CronHelper = lazy(() =>
  import("@/features/cron/CronHelper").then((m) => ({ default: m.CronHelper })),
);
const IncidentNotes = lazy(() =>
  import("@/features/incidents/IncidentNotes").then((m) => ({ default: m.IncidentNotes })),
);
const SupportHistory = lazy(() =>
  import("@/features/history/SupportHistory").then((m) => ({ default: m.SupportHistory })),
);
const SettingsPage = lazy(() =>
  import("@/features/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);

export interface ReopenRequest {
  tool: string;
  payload: unknown;
  key: number;
}

interface ToolDefinition {
  id: string;
  name: string;
  blurb: string;
  Component: React.ComponentType<{ reopen?: ReopenRequest }>;
}

const TOOLS: ToolDefinition[] = [
  { id: "log-analyzer", name: "Log Analyzer", blurb: "Rule-based log analysis + field extraction", Component: LogAnalyzer },
  { id: "log-comparison", name: "Log Comparison", blurb: "Before/after diff: new or changed errors", Component: LogComparison },
  { id: "json", name: "JSON Toolbox", blurb: "Format, validate, minify, search", Component: JsonToolbox },
  { id: "sql", name: "SQL Toolbox", blurb: "Format, safety check, basic analysis", Component: SqlToolbox },
  { id: "timestamp", name: "Timestamp Converter", blurb: "Unix / local / UTC / ISO, any timezone", Component: TimestampConverter },
  { id: "http", name: "HTTP Status Helper", blurb: "Searchable status code reference", Component: HttpStatusHelper },
  { id: "encoding", name: "Base64 / URL", blurb: "Encode and decode base64 and URLs", Component: EncodingTool },
  { id: "cron", name: "Cron Helper", blurb: "Describe 5-field cron + next 5 runs", Component: CronHelper },
  { id: "incidents", name: "Incident Notes", blurb: "Local incident records (SQLite)", Component: IncidentNotes },
  { id: "history", name: "Support History", blurb: "Saved analyses: search, re-open, delete", Component: SupportHistory },
  { id: "settings", name: "Settings", blurb: "OpenCode, privacy toggles, backup", Component: SettingsPage },
];

function toolIdFromHash(): string {
  const m = window.location.hash.match(/^#\/([a-z-]+)/);
  const id = m?.[1] ?? "";
  return TOOLS.some((t) => t.id === id) ? id : "log-analyzer";
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    setDark(next);
    try {
      localStorage.setItem("pst-theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }, []);
  return (
    <button
      onClick={toggle}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
    >
      {dark ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
      {dark ? "Light" : "Dark"}
    </button>
  );
}

export function AppShell() {
  const [activeId, setActiveId] = useState<string>("log-analyzer");
  const [reopen, setReopen] = useState<ReopenRequest | null>(null);

  const navigate = useCallback((id: string) => {
    setActiveId(id);
    setReopen(null);
    if (window.location.hash !== `#/${id}`) {
      window.location.hash = `#/${id}`;
    }
  }, []);

  useEffect(() => {
    setActiveId(toolIdFromHash());
    const onHashChange = () => setActiveId(toolIdFromHash());
    // Support History dispatches this to re-open a saved analysis.
    const onReopen = (event: Event) => {
      const detail = (event as CustomEvent<{ tool: string; payload: unknown }>).detail;
      if (!detail || !TOOLS.some((t) => t.id === detail.tool)) return;
      navigate(detail.tool);
      setReopen({ tool: detail.tool, payload: detail.payload, key: Date.now() });
    };
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("pst:reopen", onReopen);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("pst:reopen", onReopen);
    };
  }, [navigate]);

  const activeTool = TOOLS.find((t) => t.id === activeId) ?? TOOLS[0];
  const ActiveComponent = activeTool.Component;

  return (
    <div className="min-h-screen lg:flex">
      {/* Sidebar */}
      <aside className="lg:fixed lg:inset-y-0 lg:left-0 lg:w-60 lg:border-r lg:border-zinc-200 lg:bg-zinc-50 lg:dark:border-zinc-800 lg:dark:bg-zinc-900">
        <div className="flex flex-col lg:h-full">
          <div className="px-4 pb-3 pt-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-400">
              Production Support
            </p>
            <h1 className="text-base font-bold leading-tight text-zinc-900 dark:text-zinc-50">
              Toolbox
            </h1>
          </div>

          {/* Mobile selector */}
          <div className="px-3 pb-2 lg:hidden">
            <select
              value={activeId}
              onChange={(e) => navigate(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              aria-label="Choose tool"
            >
              {TOOLS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2" aria-label="Tools">
            {TOOLS.map((tool) => {
              const active = tool.id === activeId;
              return (
                <button
                  key={tool.id}
                  onClick={() => navigate(tool.id)}
                  className={`block w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    active
                      ? "bg-blue-600 font-medium text-white shadow-sm dark:bg-blue-500"
                      : "text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                >
                  <span className="block">{tool.name}</span>
                  <span
                    className={`block truncate text-[11px] ${
                      active ? "text-blue-100 dark:text-blue-100" : "text-zinc-500 dark:text-zinc-500"
                    }`}
                  >
                    {tool.blurb}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="border-t border-zinc-200 px-4 py-3 lg:border-zinc-800">
            <div className="flex items-center justify-between">
              <SeverityBadge severity="Informational" />
              <ThemeToggle />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-500">
              All processing is local. Nothing is uploaded, no telemetry.
            </p>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 px-4 py-4 sm:px-6 lg:ml-60 lg:px-8">
        <header className="mb-4 flex flex-wrap items-start justify-between gap-2 border-b border-zinc-200 pb-3 dark:border-zinc-800">
          <div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
              {activeTool.name}
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{activeTool.blurb}</p>
          </div>
        </header>
        <Suspense
          fallback={
            <div className="py-16 text-center text-sm text-zinc-400 dark:text-zinc-500">
              Loading…
            </div>
          }
        >
          <ActiveComponent key={activeTool.id} reopen={reopen ?? undefined} />
        </Suspense>
      </main>
    </div>
  );
}