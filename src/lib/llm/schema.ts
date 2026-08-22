/**
 * Client-side validation of the model's JSON output (Phase 3, section 7.3).
 * Strict on structure — an invalid analysis is rejected wholesale so the UI
 * never displays hallucinated fields; minor text issues are coerced (trim +
 * cap) rather than failed.
 */

import type { AiAnalysis, Severity } from "@/types";

const ALLOWED_SEVERITIES: Severity[] = [
  "Critical",
  "High",
  "Medium",
  "Low",
  "Informational",
];

// Re-exported so existing importers of the schema module keep working.
export type { AiAnalysis } from "@/types";

const LIMITS = {
  errorTypes: 10,
  nextSteps: 10,
  rootCause: 2000,
  explanation: 4000,
  evidenceLines: 20,
  stepLength: 500,
};

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function cleanStrings(value: unknown, maxCount: number, maxLength: number): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value.slice(0, maxCount)) {
    if (!isString(item)) return null;
    const cleaned = item.trim().slice(0, maxLength);
    if (cleaned) out.push(cleaned);
  }
  return out;
}

/**
 * Validate and normalise a parsed model response. Returns null when the
 * response is not a structurally valid analysis.
 */
export function validateAiAnalysis(value: unknown): AiAnalysis | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;

  const severity = isString(raw.severity)
    ? (raw.severity.trim() as Severity)
    : null;
  if (!severity || !ALLOWED_SEVERITIES.includes(severity)) return null;

  const errorTypes = cleanStrings(raw.errorTypes, LIMITS.errorTypes, 100);
  const nextSteps = cleanStrings(raw.nextSteps, LIMITS.nextSteps, LIMITS.stepLength);
  if (errorTypes === null || nextSteps === null) return null;

  const rootCause = isString(raw.rootCause) ? raw.rootCause.trim().slice(0, LIMITS.rootCause) : "";
  if (!rootCause) return null;

  const explanation = isString(raw.explanation)
    ? raw.explanation.trim().slice(0, LIMITS.explanation)
    : "";

  if (!Array.isArray(raw.evidenceLines)) return null;
  const evidenceLines: number[] = [];
  for (const item of raw.evidenceLines.slice(0, LIMITS.evidenceLines)) {
    if (typeof item !== "number" || !Number.isInteger(item) || item < 1) return null;
    evidenceLines.push(item);
  }

  const confidence = raw.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  if (confidence < 0 || confidence > 1) return null;

  return {
    severity,
    errorTypes,
    rootCause,
    evidenceLines,
    nextSteps,
    confidence,
    explanation,
  };
}