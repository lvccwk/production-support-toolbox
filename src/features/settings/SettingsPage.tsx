"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, ErrorNote, Note, ResultBlock } from "@/components/ui";
import { TransferButtons } from "@/components/TransferButtons";

/**
 * Settings page (Phase 3): OpenRouter readiness, privacy toggles, cache
 * management and backup export. Static configuration (keys, binary path)
 * intentionally stays in .env — this page only reflects it.
 */

interface AiStatusData {
  enabled: boolean;
  provider: string;
  configured: boolean;
  keyConfigured: boolean;
  modelConfigured: boolean;
  model: string | null;
  modelLabel: string;
  timeoutMs: number;
  masking: boolean;
  audit: boolean;
  cacheEntries: number;
}

export function SettingsPage() {
  const [status, setStatus] = useState<AiStatusData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/ai/status");
      const json = (await res.json()) as { ok?: boolean; data?: AiStatusData };
      if (json.ok && json.data) setStatus(json.data);
      else setError("Failed to load settings state.");
    } catch {
      setError("Failed to load settings state.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveToggle = async (patch: { masking?: boolean; audit?: boolean }) => {
    setSaving(true);
    setNotice("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = (await res.json()) as { ok?: boolean };
      if (!json.ok) setError("Failed to save settings.");
      else setNotice("Settings saved.");
      await refresh();
    } catch {
      setError("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  const clearCache = async () => {
    setNotice("");
    try {
      const res = await fetch("/api/settings/clear-cache", { method: "POST" });
      const json = (await res.json()) as { ok?: boolean; data?: { cleared: number } };
      if (json.ok) {
        setNotice(`Cache cleared (${json.data?.cleared ?? 0} entries).`);
        await refresh();
      } else {
        setError("Failed to clear cache.");
      }
    } catch {
      setError("Failed to clear cache.");
    }
  };

  return (
    <div className="space-y-4">
      <Card title="OpenRouter 狀態" description="Read-only summary of the .env configuration.">
        {!status && !error && (
          <p className="text-sm text-zinc-400">Loading…</p>
        )}
        {error && <ErrorNote message={error} />}
        {status && (
          <div className="grid gap-4 sm:grid-cols-2">
            <ResultBlock title="Integration">
              <ul className="space-y-1 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200">
                <li>
                  啟用:{" "}
                  <span className={status.enabled ? "font-medium text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                    {status.enabled ? "是 (PST_LLM_ENABLED=true)" : "否 — 功能關閉"}
                  </span>
                </li>
                <li>
                  Transport: <code className="font-mono text-xs">OpenRouter (REST)</code>{" "}
                  <span className={status.configured ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                    {status.configured ? "已設定" : "未完成設定"}
                  </span>
                </li>
                <li>
                  API Key (OPENROUTER_API_KEY):{" "}
                  <span className={status.keyConfigured ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                    {status.keyConfigured ? "已設定" : "缺少(server 端 .env)"}
                  </span>
                </li>
                <li>
                  模型: {status.modelLabel}
                  {!status.modelConfigured && (
                    <span className="text-red-600 dark:text-red-400"> (缺少 PST_OPENROUTER_MODEL)</span>
                  )}
                </li>
                <li>超時: {(status.timeoutMs / 1000).toFixed(0)} 秒</li>
              </ul>
            </ResultBlock>
            <ResultBlock title="Privacy & Tooling">
              <ul className="space-y-1 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200">
                <li>快取項目: {status.cacheEntries}</li>
                <li>備份: 每日自動寫入 data/backups(PST_AUTO_BACKUP=off 可關)</li>
              </ul>
            </ResultBlock>
          </div>
        )}
      </Card>

      <Card
        title="隱私設定"
        description="Runtime toggles (stored in the local settings table)."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={saving}>
            Refresh
          </Button>
        }
      >
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={status?.masking ?? true}
              disabled={!status}
              onChange={(e) => void saveToggle({ masking: e.target.checked })}
            />
            外送前自動遮蔽敏感值(密碼/token/authorization…)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={status?.audit ?? false}
              disabled={!status}
              onChange={(e) => void saveToggle({ audit: e.target.checked })}
            />
            記錄外送審計軌跡(llm_calls 表,本地)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void clearCache()} disabled={!status}>
              清除 AI 快取
            </Button>
            {notice && <Note tone="ok">{notice}</Note>}
          </div>
        </div>
      </Card>

      <Card
        title="備份 / 匯出"
        description="JSON = 完整備份(兩張表);CSV = 分表匯出。匯入會自動跳過重複項目。"
      >
        <TransferButtons scope="incidents" />
      </Card>

      <p className="text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
        設定說明:OPENROUTER_API_KEY 與 OpenRouter 選項全部在 <code>.env</code>(參考
        <code> .env.example</code>)。金鑰只存在伺服器端,永不傳到瀏覽器。
      </p>
    </div>
  );
}