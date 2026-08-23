import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, initDb } from "./db";
import {
  createIncident,
  deleteIncident,
  getIncident,
  listIncidents,
  updateIncident,
  validateIncidentInput,
} from "./incidents";
import {
  createHistoryEntry,
  deleteHistoryEntry,
  getHistoryEntry,
  listHistory,
  validateHistoryInput,
} from "./history";
import { ToolError } from "@/lib/errors";

let tempDir: string;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pst-db-"));
  initDb(path.join(tempDir, "test.db"));
});

afterAll(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("incident repository (section 14)", () => {
  it("creates and reads back an incident", () => {
    const incident = createIncident(
      validateIncidentInput({
        title: "Payment batch NPE",
        system: "PaymentBatch",
        environment: "Production",
        severity: "High",
        detectedAt: "2026-08-21 10:15:22",
        symptoms: "Batch job failed",
        rootCause: "Null input",
        immediateFix: "Restart batch",
        permanentFix: "Add validation",
        status: "Investigating",
        notes: "transactionId=ABC123",
      }),
    );
    expect(incident.id).toBeGreaterThan(0);
    expect(incident.title).toBe("Payment batch NPE");
    expect(incident.status).toBe("Investigating");

    const loaded = getIncident(incident.id);
    expect(loaded?.system).toBe("PaymentBatch");
    expect(loaded?.severity).toBe("High");
  });

  it("updates an incident", () => {
    const incident = createIncident(
      validateIncidentInput({ title: "Temp issue", status: "Investigating", severity: "Low" }),
    );
    const updated = updateIncident(incident.id, {
      ...incident,
      title: "Temp issue (resolved)",
      status: "Closed",
    });
    expect(updated?.title).toBe("Temp issue (resolved)");
    expect(updated?.status).toBe("Closed");
  });

  it("deletes an incident", () => {
    const incident = createIncident(
      validateIncidentInput({ title: "To delete", status: "Investigating", severity: "Low" }),
    );
    expect(deleteIncident(incident.id)).toBe(true);
    expect(getIncident(incident.id)).toBeNull();
    expect(deleteIncident(incident.id)).toBe(false);
  });

  it("searches incidents", () => {
    createIncident(
      validateIncidentInput({ title: "Alpha outage", system: "AlphaSvc", status: "Monitoring", severity: "Critical" }),
    );
    createIncident(
      validateIncidentInput({ title: "Beta slow", system: "BetaSvc", status: "Closed", severity: "Medium" }),
    );
    const results = listIncidents("Alpha");
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("Alpha outage");
    expect(listIncidents("does-not-exist-xyz")).toHaveLength(0);
  });

  it("validates required fields and enums", () => {
    expect(() => validateIncidentInput({ title: "", status: "Investigating" })).toThrowError(
      /title is required/i,
    );
    expect(() =>
      validateIncidentInput({ title: "x", status: "Investigating", severity: "SuperBad" as never }),
    ).toThrowError(/Invalid severity/);
    expect(() =>
      validateIncidentInput({ title: "x", status: "WrongStatus" as never, severity: "Low" }),
    ).toThrowError(/Invalid status/);
    expect(() =>
      validateIncidentInput({ title: "x".repeat(300), status: "Investigating", severity: "Low" }),
    ).toThrowError(ToolError);
  });
});

describe("history repository (section 15)", () => {
  it("stores and lists entries, never automatically", () => {
    createHistoryEntry(
      validateHistoryInput({
        tool: "log-analyzer",
        system: "PaymentBatch",
        summary: "NPE in batch job",
        severity: "High",
        payload: JSON.stringify({ analysis: "x" }),
      }),
    );
    const all = listHistory();
    expect(all.length).toBe(1);
    expect(all[0].tool).toBe("log-analyzer");
    expect(all[0].severity).toBe("High");
  });

  it("supports search, re-open and delete", () => {
    const entry = createHistoryEntry(
      validateHistoryInput({
        tool: "json",
        system: "",
        summary: "Bad payload",
        severity: null,
        payload: '{"a":1}',
      }),
    );
    expect(listHistory("Bad payload")).toHaveLength(1);
    const loaded = getHistoryEntry(entry.id);
    expect(loaded?.payload).toBe('{"a":1}');
    expect(deleteHistoryEntry(entry.id)).toBe(true);
    expect(getHistoryEntry(entry.id)).toBeNull();
  });

  it("rejects unknown tools and empty summaries", () => {
    expect(() =>
      validateHistoryInput({ tool: "hacker", summary: "x" }),
    ).toThrowError(/Unknown tool/);
    expect(() => validateHistoryInput({ tool: "json", summary: "  " })).toThrowError(
      /Summary is required/,
    );
  });

  it("rejects invalid severity", () => {
    expect(() =>
      validateHistoryInput({ tool: "timestamp", summary: "x", severity: "Epic" as never }),
    ).toThrowError(/Invalid severity/);
  });
});