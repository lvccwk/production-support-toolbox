"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  ErrorNote,
  Field,
  Input,
  Note,
  Select,
  SeverityBadge,
  TextArea,
} from "@/components/ui";
import { apiFetch, errorMessage } from "@/lib/api/client";
import type { AlertRule, Notification, Severity } from "@/types";

/**
 * Alerts — configure rules that react to SAVED analyses (deterministic,
 * local) and browse the notification log. A rule needs nothing but a
 * condition to work (in-app entry); webhooks are an optional extra delivery
 * channel (generic POST JSON — Teams/Slack/anything). Cooldown suppresses
 * repeat spam for the same system/severity/error-type signature.
 */

const SEVERITIES: Severity[] = ["Critical", "High", "Medium", "Low", "Informational"];

async function readJson<T>(res: Response): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const json = (await res.json()) as { ok: boolean; data?: T; error?: unknown };
    return { ok: json.ok, data: json.data, error: errorMessage(json) };
  } catch {
    return { ok: false, error: "Unexpected server response." };
  }
}

function lineItems(text: string): string[] {
  return text
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

interface AlertForm {
  name: string;
  minSeverity: Severity;
  errorTypes: string;
  systems: string;
  tools: string;
  webhookUrls: string;
  cooldownMinutes: string;
  active: boolean;
}

function emptyForm(): AlertForm {
  return {
    name: "",
    minSeverity: "High",
    errorTypes: "",
    systems: "",
    tools: "log-analyzer",
    webhookUrls: "",
    cooldownMinutes: "60",
    active: true,
  };
}

function toBody(form: AlertForm): Record<string, unknown> {
  const urls = lineItems(form.webhookUrls);
  return {
    name: form.name,
    active: form.active,
    condition: {
      minSeverity: form.minSeverity,
      errorTypes: lineItems(form.errorTypes),
      systems: lineItems(form.systems),
      tools: lineItems(form.tools),
    },
    channels: urls.map((url) => ({ type: "webhook", url })),
    cooldownMinutes: Number(form.cooldownMinutes) || 0,
  };
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<AlertForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState("");
  const [savedNote, setSavedNote] = useState("");

  const loadNotifications = useCallback(async () => {
    try {
      const res = await apiFetch("/api/notifications?limit=100");
      const json = await readJson<{ notifications: Notification[] }>(res);
      if (json.ok && json.data) setNotifications(json.data.notifications);
    } catch {
      // Non-fatal — the rules list is the primary content.
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/alerts");
      const json = await readJson<{ rules: AlertRule[]; alertsEnabled: boolean }>(res);
      if (json.ok && json.data) {
        setRules(json.data.rules);
        setAlertsEnabled(json.data.alertsEnabled);
        setError("");
      } else {
        setError(json.error ?? "Failed to load alert rules.");
      }
    } catch {
      setError("Failed to load alert rules.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void loadNotifications();
  }, [refresh, loadNotifications]);

  const startCreate = () => {
    setEditingId("new");
    setForm(emptyForm());
    setError("");
    setTestResult("");
  };

  const startEdit = (rule: AlertRule) => {
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      minSeverity: rule.condition.minSeverity,
      errorTypes: rule.condition.errorTypes.join(", "),
      systems: rule.condition.systems.join(", "),
      tools: rule.condition.tools.join(", "),
      webhookUrls: rule.channels.map((c) => c.url).join("\n"),
      cooldownMinutes: String(rule.cooldownMinutes),
      active: rule.active,
    });
    setError("");
    setTestResult("");
  };

  const patchForm = <K extends keyof AlertForm>(key: K, value: AlertForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setSavedNote("");
    setTestResult("");
    try {
      const method = editingId === "new" ? "POST" : "PUT";
      const url = editingId === "new" ? "/api/alerts" : `/api/alerts/${String(editingId)}`;
      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toBody(form)),
      });
      const json = await readJson(res);
      if (!json.ok) {
        setError(json.error ?? "Failed to save alert rule.");
        return;
      }
      setSavedNote(editingId === "new" ? "規則已建立。" : "規則已儲存。");
      setEditingId(null);
      void refresh();
    } catch {
      setError("Failed to save alert rule.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (rule: AlertRule) => {
    setError("");
    try {
      const res = await apiFetch(`/api/alerts/${rule.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !rule.active }),
      });
      const json = await readJson(res);
      if (!json.ok) setError(json.error ?? "Failed to update rule.");
      else void refresh();
    } catch {
      setError("Failed to update rule.");
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm("刪除呢條 alert rule？")) return;
    setError("");
    try {
      const res = await apiFetch(`/api/alerts/${id}`, { method: "DELETE" });
      const json = await readJson(res);
      if (!json.ok) setError(json.error ?? "Failed to delete rule.");
      else {
        if (editingId === id) setEditingId(null);
        void refresh();
      }
    } catch {
      setError("Failed to delete rule.");
    }
  };

  const test = async (rule: AlertRule) => {
    setTestingId(rule.id);
    setTestResult("");
    try {
      const res = await apiFetch(`/api/alerts/${rule.id}/test`, { method: "POST" });
      const json = await readJson<{ delivered: boolean; detail: string }>(res);
      if (!json.ok) {
        setTestResult(`「${rule.name}」測試失敗：${json.error ?? "request failed"}`);
      } else if (json.data) {
        setTestResult(
          json.data.delivered
            ? `「${rule.name}」✅ 送達成功（${json.data.detail}）`
            : `「${rule.name}」❌ Webhook 拒絕：${json.data.detail}`,
        );
      }
      void loadNotifications();
    } catch {
      setTestResult("測試失敗：無法連接伺服器。");
    } finally {
      setTestingId(null);
    }
  };

  const clearNotifications = async () => {
    if (!window.confirm("清空全部通知記錄？")) return;
    try {
      const res = await apiFetch("/api/notifications", { method: "DELETE" });
      const json = await readJson(res);
      if (!json.ok) setError(json.error ?? "Failed to clear notifications.");
      else setNotifications([]);
    } catch {
      setError("Failed to clear notifications.");
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setError("");
    setTestResult("");
  };

  return (
    <div className="space-y-4">
      {!alertsEnabled && (
        <Note tone="warn">
          目前 PST_ALERTS_ENABLED=false —— 規則可以配置，但唔會觸發。想啟用就設
          PST_ALERTS_ENABLED=true 之後重啟。
        </Note>
      )}

      <Card
        title="Alert 規則"
        description="條件：minSeverity（>=）+ 可選 errorTypes / systems / tools 過濾。每次「Save Analysis」都會評估（唔會自動分析觸發）；中咗就記錄落通知 ＋（有 webhook 先）POST JSON 出去。Cooldown 防止同一個 signal 重複轟炸。"
        actions={
          <Button variant="primary" size="sm" onClick={startCreate} disabled={editingId !== null}>
            新增規則 New Rule
          </Button>
        }
      >
        {error && (
          <div className="mb-3">
            <ErrorNote message={error} />
          </div>
        )}
        {savedNote && (
          <div className="mb-3">
            <Note tone="ok">{savedNote}</Note>
          </div>
        )}

        {editingId !== null && (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900 dark:bg-blue-950/30">
            <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {editingId === "new" ? "新增 Alert 規則" : `編輯規則 #${editingId}`}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name">
                <Input
                  value={form.name}
                  onChange={(e) => patchForm("name", e.target.value)}
                  placeholder="例如 PAY 閘道 High 錯誤"
                />
              </Field>
              <Field label="Min Severity（>= 先觸發）">
                <Select
                  value={form.minSeverity}
                  onChange={(e) => patchForm("minSeverity", e.target.value as Severity)}
                >
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Error Types（可選，逗號分隔）">
                <Input
                  value={form.errorTypes}
                  onChange={(e) => patchForm("errorTypes", e.target.value)}
                  placeholder="SQL Exception, Timeout"
                />
              </Field>
              <Field label="Systems（可選，逗號分隔）">
                <Input
                  value={form.systems}
                  onChange={(e) => patchForm("systems", e.target.value)}
                  placeholder="ledger"
                />
              </Field>
              <Field label="Tools（逗號分隔，預設 log-analyzer）">
                <Input
                  value={form.tools}
                  onChange={(e) => patchForm("tools", e.target.value)}
                  placeholder="log-analyzer"
                />
              </Field>
              <Field label="Cooldown（分鐘，0 = 冇 cooldown）">
                <Input
                  type="number"
                  min={0}
                  max={10080}
                  value={form.cooldownMinutes}
                  onChange={(e) => patchForm("cooldownMinutes", e.target.value)}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Webhook URLs（可選，每個一行 — http/https）">
                  <TextArea
                    mono
                    rows={2}
                    value={form.webhookUrls}
                    onChange={(e) => patchForm("webhookUrls", e.target.value)}
                    placeholder={"https://hooks.example.com/team-alerts\nhttps://example.com/webhook"}
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => patchForm("active", e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                />
                啟用 Active
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="primary" size="sm" onClick={() => void save()} disabled={saving}>
                {saving ? "儲存中…" : "儲存 Save"}
              </Button>
              <Button variant="secondary" size="sm" onClick={cancelEdit}>
                取消 Cancel
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>
        ) : rules.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">
            未有 alert 規則。撳「新增規則」開始 —— 淨係填個 condition 已經有用（站內通知），
            加 webhook 先會送出 JSON。
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rules.map((rule) => (
              <li key={rule.id} className="py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {rule.name}
                  </span>
                  <SeverityBadge severity={rule.condition.minSeverity} />
                  {rule.channels.length > 0 ? (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      {rule.channels.length} webhook
                    </span>
                  ) : (
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      站內通知 only
                    </span>
                  )}
                  {!rule.active && (
                    <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      停用 Inactive
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {[
                    rule.condition.errorTypes.length > 0
                      ? `errorTypes: ${rule.condition.errorTypes.join(", ")}`
                      : "",
                    rule.condition.systems.length > 0
                      ? `systems: ${rule.condition.systems.join(", ")}`
                      : "",
                    `cooldown: ${rule.cooldownMinutes} min`,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "全部工具、全部系統"}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => startEdit(rule)}>
                    編輯 Edit
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => void toggleActive(rule)}>
                    {rule.active ? "停用 Deactivate" : "啟用 Activate"}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => void test(rule)} disabled={testingId === rule.id}>
                    {testingId === rule.id ? "測試中…" : "Send Test"}
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => void remove(rule.id)}>
                    刪除 Delete
                  </Button>
                </div>
                {testResult && editingId === null && (
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{testResult}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="通知記錄 Notifications"
        description="每次觸發都一定記錄（就算 webhook 失敗都會記 status=failed）。Webhook payload 只包 rule + 安全摘要（system / summary / severity / errorTypes）—— 唔會送出原始 log。"
        actions={
          notifications.length > 0 ? (
            <Button variant="danger" size="sm" onClick={() => void clearNotifications()}>
              清空 Clear
            </Button>
          ) : undefined
        }
      >
        {notifications.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">
            未有通知。建立一條 alert 規則再 Save 一個 High+ 分析就會見到。
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {notifications.map((n) => (
              <li key={n.id} className="py-2.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                    {formatWhen(n.createdAt)}
                  </span>
                  <SeverityBadge severity={n.level} />
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                      n.status === "sent"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                    }`}
                  >
                    {n.channel} · {n.status}
                  </span>
                </div>
                <p className="mt-0.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {n.title}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{n.message}</p>
                {n.detail && (
                  <p className="mt-0.5 break-all font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                    {n.detail}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Note tone="info">
        Alerts 只會喺「Save Analysis」時評估 —— 係明示、確定性嘅一刻，唔會自動跑。匯入／
        backfill 唔會觸發，避免 bulk restore 洗版。
      </Note>
    </div>
  );
}