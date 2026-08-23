"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, ErrorNote, Note } from "@/components/ui";
import { apiFetch, errorMessage } from "@/lib/api/client";
import type { DashboardSummary } from "@/types";

/**
 * Dashboard — aggregated report over saved analyses + incidents (replaces
 * "open a CSV to see anything"): totals, severity distribution, top error
 * types, tool/system usage, a daily High+ trend and incident statuses.
 * Pure CSS bars — no chart library, deterministic, local.
 */

async function readJson<T>(res: Response): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const json = (await res.json()) as { ok: boolean; data?: T; error?: unknown };
    return { ok: json.ok, data: json.data, error: errorMessage(json) };
  } catch {
    return { ok: false, error: "Unexpected server response." };
  }
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{sub}</p>}
    </div>
  );
}

/** Horizontal bar list: name + count + proportional bar. */
function BarList({
  items,
  empty,
  barClass = "bg-blue-600 dark:bg-blue-500",
}: {
  items: Array<{ name: string; count: number }>;
  empty: string;
  barClass?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.count));
  if (items.length === 0) {
    return <p className="py-4 text-center text-sm text-zinc-400 dark:text-zinc-500">{empty}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.name} className="flex items-center gap-2">
          <span className="w-40 truncate text-xs text-zinc-600 dark:text-zinc-300" title={item.name}>
            {item.name}
          </span>
          <div className="h-3 flex-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
            <div
              className={`h-full rounded ${barClass}`}
              style={{ width: `${Math.max(3, (item.count / max) * 100)}%` }}
            />
          </div>
          <span className="w-8 text-right text-xs font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">
            {item.count}
          </span>
        </li>
      ))}
    </ul>
  );
}

function TrendChart({ trend }: { trend: DashboardSummary["history"]["trend"] }) {
  const max = Math.max(1, ...trend.map((t) => t.total));
  return (
    <div>
      <div className="flex h-32 items-end gap-[3px]">
        {trend.map((bucket) => (
          <div
            key={bucket.day}
            className="group relative flex-1"
            title={`${bucket.day}: ${bucket.total} 單（High+ ${bucket.highPlus}）`}
          >
            <div className="relative w-full overflow-hidden rounded-t bg-zinc-200 dark:bg-zinc-700" style={{ height: `${Math.max(2, (bucket.total / max) * 100)}%` }}>
              {bucket.highPlus > 0 && (
                <div className="absolute bottom-0 w-full bg-red-500 dark:bg-red-400" style={{ height: `${(bucket.highPlus / Math.max(1, bucket.total)) * 100}%` }} />
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-zinc-400 dark:text-zinc-500">
        <span>{trend[0]?.day ?? ""}</span>
        <span>過去 {trend.length} 日（總數 / 紅色 = High+）</span>
        <span>{trend[trend.length - 1]?.day ?? ""}</span>
      </div>
    </div>
  );
}

export function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/dashboard");
      const json = await readJson<DashboardSummary>(res);
      if (json.ok && json.data) {
        setSummary(json.data);
        setError("");
      } else {
        setError(json.error ?? "Failed to load dashboard.");
      }
    } catch {
      setError("Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || !summary) {
    return <p className="py-16 text-center text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>;
  }

  const { history, incidents } = summary;
  const highPlus = history.bySeverity
    .filter((s) => s.severity === "High" || s.severity === "Critical")
    .reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="space-y-4">
      {error && <ErrorNote message={error} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Saved Analyses" value={history.total} sub="Support History 總數" />
        <StatCard label="High+ 分析" value={highPlus} sub="High / Critical 佔比" />
        <StatCard label="AI Fallback" value={history.aiFallbackCount} sub="規則 0-match 時由 AI 補位" />
        <StatCard label="Open Incidents" value={incidents.open} sub={`共 ${incidents.total} 單`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="趨勢 Trend" description="每日儲存分析總數；紅色 = High+（High / Critical）">
          {history.trend.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">
              未有歷史數據 — 喺工具入面撳「Save Analysis」就會喺度出現。
            </p>
          ) : (
            <TrendChart trend={history.trend} />
          )}
        </Card>

        <Card title="Severity 分佈" description="按儲存分析嘅嚴重度">
          {history.bySeverity.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">未有數據</p>
          ) : (
            <ul className="space-y-1.5">
              {history.bySeverity.map((s) => (
                <li key={s.severity} className="flex items-center gap-2">
                  <span className="w-28 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    {s.severity}
                  </span>
                  <div className="h-3 flex-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className={`h-full rounded ${
                        s.severity === "Critical"
                          ? "bg-red-600"
                          : s.severity === "High"
                            ? "bg-orange-500"
                            : s.severity === "Medium"
                              ? "bg-amber-500"
                              : "bg-sky-500"
                      }`}
                      style={{
                        width: `${Math.max(3, (s.count / Math.max(1, history.bySeverity[0].count)) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="w-8 text-right text-xs font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">
                    {s.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="常見 Error Types" description="由已儲存嘅分析快照抽出（JSON1 直接喺 SQLite 聚合）">
          <BarList
            items={history.errorTypes}
            empty="未有 log-analyzer 分析記錄"
            barClass="bg-orange-500 dark:bg-orange-400"
          />
        </Card>

        <Card title="Incidents 狀態" description={`共 ${incidents.total} 單，開緊 ${incidents.open} 單`}>
          <BarList
            items={incidents.byStatus}
            empty="未有 incidents"
            barClass="bg-violet-500 dark:bg-violet-400"
          />
        </Card>

        <Card title="工具用量" description="邊個工具儲得最多分析">
          <BarList items={history.byTool} empty="未有數據" />
        </Card>

        <Card title="系統 Top 10" description="最多分析嘅系統">
          <BarList items={history.bySystem} empty="未有數據" />
        </Card>
      </div>

      <Note tone="info">
        呢個係即時聚合（每次載入都重算）—— 要完整明細（input、evidence、payload）就用
        Support History 或 CSV 匯出。Dashboard 只係「睇趨勢」嘅入口。
      </Note>
    </div>
  );
}