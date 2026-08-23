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
import type { CustomRule, Severity } from "@/types";

/**
 * Custom Rules GUI — the human-facing counterpart of /api/tools/rules so a
 * non-technical support person can manage detection rules without the agent
 * API: create / edit / activate / deactivate / delete, one pattern per line,
 * with the server's full validation (regex syntax + ReDoS screening + torture
 * test) running on every save.
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

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toCsv(items: string[] | undefined): string {
  return (items ?? []).join("\n");
}

interface RuleForm {
  name: string;
  scopeType: "global" | "systems" | "components";
  scopeValues: string;
  patterns: string;
  severity: Severity;
  active: boolean;
  affectedComponents: string;
  rootCauses: string;
  investigation: string;
  suggestedFixes: string;
  longTermImprovements: string;
}

function emptyForm(): RuleForm {
  return {
    name: "",
    scopeType: "global",
    scopeValues: "",
    patterns: "",
    severity: "Medium",
    active: true,
    affectedComponents: "",
    rootCauses: "",
    investigation: "",
    suggestedFixes: "",
    longTermImprovements: "",
  };
}

function fromRule(rule: CustomRule): RuleForm {
  return {
    name: rule.name,
    scopeType: rule.scope.type,
    scopeValues: rule.scope.values.join("\n"),
    patterns: rule.patterns.join("\n"),
    severity: rule.severity,
    active: rule.active,
    affectedComponents: toCsv(rule.affectedComponents),
    rootCauses: toCsv(rule.rootCauses),
    investigation: toCsv(rule.investigation),
    suggestedFixes: toCsv(rule.suggestedFixes),
    longTermImprovements: toCsv(rule.longTermImprovements),
  };
}

function toBody(form: RuleForm): Record<string, unknown> {
  return {
    name: form.name,
    scope: {
      type: form.scopeType,
      values: lines(form.scopeValues),
    },
    patterns: lines(form.patterns),
    severity: form.severity,
    active: form.active,
    affectedComponents: lines(form.affectedComponents),
    rootCauses: lines(form.rootCauses),
    investigation: lines(form.investigation),
    suggestedFixes: lines(form.suggestedFixes),
    longTermImprovements: lines(form.longTermImprovements),
  };
}

export function RulesManager() {
  const [rules, setRules] = useState<CustomRule[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [cap, setCap] = useState(200);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<RuleForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/tools/rules");
      const json = await readJson<{ rules: CustomRule[]; activeCount: number; cap: number }>(res);
      if (json.ok && json.data) {
        setRules(json.data.rules);
        setActiveCount(json.data.activeCount);
        setCap(json.data.cap);
        setError("");
      } else {
        setError(json.error ?? "Failed to load rules.");
      }
    } catch {
      setError("Failed to load rules.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startCreate = () => {
    setEditingId("new");
    setForm(emptyForm());
    setError("");
  };

  const startEdit = (rule: CustomRule) => {
    setEditingId(rule.id);
    setForm(fromRule(rule));
    setError("");
  };

  const patchForm = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setSavedNote("");
    try {
      const method = editingId === "new" ? "POST" : "PUT";
      const url =
        editingId === "new" ? "/api/tools/rules" : `/api/tools/rules/${String(editingId)}`;
      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toBody(form)),
      });
      const json = await readJson<{ rule?: CustomRule }>(res);
      if (!json.ok) {
        setError(json.error ?? "Failed to save rule.");
        return;
      }
      setSavedNote(editingId === "new" ? "規則已建立。" : "規則已儲存。");
      setEditingId(null);
      void refresh();
    } catch {
      setError("Failed to save rule.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (rule: CustomRule) => {
    setError("");
    try {
      const res = await apiFetch(`/api/tools/rules/${rule.id}`, {
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
    if (!window.confirm("刪除呢條規則？刪咗冇得返轉頭。")) return;
    setError("");
    try {
      const res = await apiFetch(`/api/tools/rules/${id}`, { method: "DELETE" });
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

  const cancelEdit = () => {
    setEditingId(null);
    setError("");
  };

  const scopeLabel = (scopeType: string): string =>
    scopeType === "systems" ? "Systems" : scopeType === "components" ? "Components" : "Global";

  return (
    <div className="space-y-4">
      <Card
        title="自訂偵測規則 Custom Rules"
        description={`教個引擎認你哋系統嘅失敗特徵（scope 分 global / systems / components）。每個 pattern 儲存前都會過：regex 語法檢查 + 靜態 ReDoS 篩查 + 限時 torture test。Active 規則上限 ${cap}。`}
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

        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            啟用中：<strong>{activeCount}</strong> / {cap}
          </span>
          {activeCount >= cap && (
            <Note tone="warn">Active 規則數量已達上限 — 要先停用或刪除先可以再加。</Note>
          )}
        </div>

        {editingId !== null && (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900 dark:bg-blue-950/30">
            <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {editingId === "new" ? "新增規則" : `編輯規則 #${editingId}`}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name（規則名）">
                <Input
                  value={form.name}
                  onChange={(e) => patchForm("name", e.target.value)}
                  placeholder="例如 PaymentBatch-STEP44-timeout"
                />
              </Field>
              <Field label="Severity（命中時嘅嚴重度）">
                <Select
                  value={form.severity}
                  onChange={(e) => patchForm("severity", e.target.value as Severity)}
                >
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Scope Type">
                <Select
                  value={form.scopeType}
                  onChange={(e) =>
                    patchForm("scopeType", e.target.value as RuleForm["scopeType"])
                  }
                >
                  <option value="global">Global（所有系統）</option>
                  <option value="systems">Systems（指定系統）</option>
                  <option value="components">Components（指定元件）</option>
                </Select>
              </Field>
              <Field
                label={`Scope Values${form.scopeType === "global" ? "（唔使填）" : "（每個一行）"}`}
              >
                <TextArea
                  rows={2}
                  value={form.scopeValues}
                  onChange={(e) => patchForm("scopeValues", e.target.value)}
                  placeholder={form.scopeType === "systems" ? "ledger" : "PaymentBatch"}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Patterns（偵測 pattern，每個一行 — regex）">
                  <TextArea
                    mono
                    rows={3}
                    value={form.patterns}
                    onChange={(e) => patchForm("patterns", e.target.value)}
                    placeholder={"STEP44.*timeout\nDB connection refused"}
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

            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
                分析輸出欄位（可選，每個一行）— affected components / root causes / investigation / fixes
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                <Field label="Affected Components">
                  <TextArea rows={3} value={form.affectedComponents} onChange={(e) => patchForm("affectedComponents", e.target.value)} placeholder={"LedgerTransaction\nDatabase"} />
                </Field>
                <Field label="Root Causes（英文，可加中文平均…）">
                  <TextArea rows={3} value={form.rootCauses} onChange={(e) => patchForm("rootCauses", e.target.value)} placeholder={"PAY gateway timeout at STEP44"} />
                </Field>
                <Field label="Investigation（英文）">
                  <TextArea rows={3} value={form.investigation} onChange={(e) => patchForm("investigation", e.target.value)} placeholder={"Check gateway timeout logs"} />
                </Field>
                <Field label="Suggested Fixes（英文）">
                  <TextArea rows={3} value={form.suggestedFixes} onChange={(e) => patchForm("suggestedFixes", e.target.value)} placeholder={"Retry STEP44 with backoff"} />
                </Field>
                <Field label="Long-Term Improvements（英文）">
                  <TextArea rows={3} value={form.longTermImprovements} onChange={(e) => patchForm("longTermImprovements", e.target.value)} placeholder={"Increase gateway timeout at STEP44"} />
                </Field>
              </div>
            </details>

            <div className="mt-4 flex gap-2">
              <Button variant="primary" size="sm" onClick={() => void save()} disabled={saving}>
                {saving ? "驗證中 Validating…" : "儲存 Save"}
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
            未有自訂規則 — 撳「新增規則」建立第一條，或者用 API{" "}
            <code className="font-mono text-xs">POST /api/tools/rules</code>。
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rules.map((rule) => (
              <li key={rule.id} className="py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {rule.name}
                  </span>
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {scopeLabel(rule.scope.type)}
                    {rule.scope.values.length > 0 ? `: ${rule.scope.values.join(", ")}` : ""}
                  </span>
                  <SeverityBadge severity={rule.severity} />
                  {!rule.active && (
                    <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      停用 Inactive
                    </span>
                  )}
                </div>
                <p className="mt-1 break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  {rule.patterns.map((p) => `/${p}/`).join("  ") || "—"}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => startEdit(rule)}>
                    編輯 Edit
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => void toggleActive(rule)}>
                    {rule.active ? "停用 Deactivate" : "啟用 Activate"}
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => void remove(rule.id)}>
                    刪除 Delete
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