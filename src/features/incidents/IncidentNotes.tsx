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
  StatusBadge,
  TextArea,
} from "@/components/ui";
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES } from "@/types";
import type { Incident, IncidentInput, IncidentStatus, Severity } from "@/types";
import { TransferButtons } from "@/components/TransferButtons";
import { apiFetch, errorMessage } from "@/lib/api/client";

const EMPTY_FORM: IncidentInput = {
  title: "",
  system: "",
  environment: "",
  severity: "Medium",
  detectedAt: "",
  symptoms: "",
  rootCause: "",
  immediateFix: "",
  permanentFix: "",
  status: "Investigating",
  notes: "",
};

async function readJson<T>(res: Response): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const json = (await res.json()) as { ok: boolean; data?: T; error?: unknown };
    return { ok: json.ok, data: json.data, error: errorMessage(json) };
  } catch {
    return { ok: false, error: "Unexpected server response." };
  }
}

export function IncidentNotes() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<IncidentInput>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<"saved" | "deleted" | null>(null);

  const refresh = useCallback(async (search?: string) => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/incidents${search ? `?q=${encodeURIComponent(search)}` : ""}`);
      const json = await readJson<Incident[]>(res);
      if (json.ok && json.data) setIncidents(json.data);
      else setError(json.error ?? "Failed to load incidents.");
    } catch {
      setError("Failed to load incidents.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const set = (field: keyof IncidentInput) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const save = async () => {
    setError("");
    setNotice(null);
    try {
      const url = editingId ? `/api/incidents/${editingId}` : "/api/incidents";
      const res = await apiFetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await readJson<Incident>(res);
      if (!json.ok) {
        setError(json.error ?? "Failed to save incident.");
        return;
      }
      setNotice("saved");
      resetForm();
      await refresh(query);
    } catch {
      setError("Failed to save incident.");
    }
  };

  const startEdit = (incident: Incident) => {
    setEditingId(incident.id);
    setForm({
      title: incident.title,
      system: incident.system,
      environment: incident.environment,
      severity: incident.severity,
      detectedAt: incident.detectedAt,
      symptoms: incident.symptoms,
      rootCause: incident.rootCause,
      immediateFix: incident.immediateFix,
      permanentFix: incident.permanentFix,
      status: incident.status,
      notes: incident.notes,
    });
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = async (id: number) => {
    try {
      const res = await apiFetch(`/api/incidents/${id}`, { method: "DELETE" });
      const json = await readJson(res);
      if (!json.ok) {
        setError(json.error ?? "Failed to delete incident.");
        return;
      }
      setNotice("deleted");
      if (editingId === id) resetForm();
      await refresh(query);
    } catch {
      setError("Failed to delete incident.");
    }
  };

  return (
    <div className="space-y-4">
      <Card
        title={editingId ? `Edit Incident #${editingId}` : "New Incident"}
        description="Stored in the local SQLite database (data/app.db). Nothing leaves this machine."
        actions={
          editingId ? (
            <>
              <Button variant="secondary" size="sm" onClick={resetForm}>
                Cancel edit
              </Button>
              <Button variant="primary" size="sm" onClick={save}>
                Update Incident
              </Button>
            </>
          ) : (
            <Button variant="primary" size="sm" onClick={save}>
              Create Incident
            </Button>
          )
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Incident Title *">
            <Input value={form.title} onChange={(e) => set("title")(e.target.value)} placeholder="Payment batch NPE" />
          </Field>
          <Field label="System">
            <Input value={form.system} onChange={(e) => set("system")(e.target.value)} placeholder="PaymentBatch" />
          </Field>
          <Field label="Environment">
            <Select value={form.environment} onChange={(e) => set("environment")(e.target.value)}>
              <option value="">—</option>
              <option value="Production">Production</option>
              <option value="UAT">UAT</option>
              <option value="SIT">SIT</option>
              <option value="Development">Development</option>
            </Select>
          </Field>
          <Field label="Severity">
            <Select value={form.severity} onChange={(e) => set("severity")(e.target.value as Severity)}>
              {INCIDENT_SEVERITIES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => set("status")(e.target.value as IncidentStatus)}>
              {INCIDENT_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="Detected Time">
            <Input
              mono
              value={form.detectedAt}
              onChange={(e) => set("detectedAt")(e.target.value)}
              placeholder="2026-08-21 10:15:22"
            />
          </Field>
          <Field label="Symptoms" className="sm:col-span-2 lg:col-span-3">
            <TextArea mono rows={2} value={form.symptoms} onChange={(e) => set("symptoms")(e.target.value)} />
          </Field>
          <Field label="Root Cause" className="sm:col-span-2 lg:col-span-3">
            <TextArea mono rows={2} value={form.rootCause} onChange={(e) => set("rootCause")(e.target.value)} />
          </Field>
          <Field label="Immediate Fix" className="sm:col-span-2 lg:col-span-3">
            <TextArea mono rows={2} value={form.immediateFix} onChange={(e) => set("immediateFix")(e.target.value)} />
          </Field>
          <Field label="Permanent Fix" className="sm:col-span-2 lg:col-span-3">
            <TextArea mono rows={2} value={form.permanentFix} onChange={(e) => set("permanentFix")(e.target.value)} />
          </Field>
          <Field label="Notes" className="sm:col-span-2 lg:col-span-3">
            <TextArea mono rows={2} value={form.notes} onChange={(e) => set("notes")(e.target.value)} />
          </Field>
        </div>
        {error && <div className="mt-3"><ErrorNote message={error} /></div>}
        {notice === "saved" && (
          <div className="mt-3"><Note tone="ok">Incident saved.</Note></div>
        )}
        {notice === "deleted" && (
          <div className="mt-3"><Note tone="info">Incident deleted.</Note></div>
        )}
      </Card>

      <Card
        title="Incident List"
        description="Search by title, system, environment, symptoms or notes."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search incidents…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                void refresh(e.target.value);
              }}
              className="w-64"
            />
            <TransferButtons scope="incidents" onImported={() => void refresh(query)} />
          </div>
        }
      >
        {loading ? (
          <p className="py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>
        ) : incidents.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">
            No incidents {query ? "match your search" : "yet"}.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {incidents.map((incident) => (
              <li key={incident.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
                      #{incident.id}
                    </span>
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {incident.title}
                    </span>
                    <SeverityBadge severity={incident.severity} />
                    <StatusBadge status={incident.status} />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {[incident.system, incident.environment, incident.detectedAt]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => startEdit(incident)}>
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      if (window.confirm(`Delete incident "${incident.title}"?`)) void remove(incident.id);
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