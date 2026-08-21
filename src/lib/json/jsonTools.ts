import type { JsonSearchHit, JsonValidationResult } from "@/types";
import { ToolError } from "@/lib/errors";

/**
 * JSON toolbox logic (section 8): format, validate, minify, search.
 * All functions are pure and never touch the DOM or the network.
 */

/** Derive a reasonably useful position hint from Node's JSON.parse error. */
function parseErrorPosition(message: string): number | null {
  const m = message.match(/position\s+(\d+)/i);
  return m ? Number(m[1]) : null;
}

export function validateJson(text: string): JsonValidationResult {
  try {
    JSON.parse(text);
    return { valid: true, error: null, position: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, error: message, position: parseErrorPosition(message) };
  }
}

/** Pretty-print JSON with 2-space indent. Throws ToolError on invalid input. */
export function formatJson(text: string): string {
  if (text.trim().length === 0) {
    throw new ToolError("Empty input. Paste JSON before formatting.");
  }
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    throw new ToolError("Invalid JSON. Please check syntax.");
  }
}

/** Collapse JSON into a single line. Throws ToolError on invalid input. */
export function minifyJson(text: string): string {
  if (text.trim().length === 0) {
    throw new ToolError("Empty input. Paste JSON before minifying.");
  }
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed);
  } catch {
    throw new ToolError("Invalid JSON. Please check syntax.");
  }
}

/**
 * Search JSON keys (case-insensitive) and collect every matching path/value.
 * Also matches string values that contain the query when no key matches.
 */
export function searchJson(text: string, query: string): JsonSearchHit[] {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    throw new ToolError("Please enter a search key or value.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ToolError("Invalid JSON. Please check syntax.");
  }

  const hits: JsonSearchHit[] = [];
  const wanted = trimmedQuery.toLowerCase();

  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        const childPath = path ? `${path}.${key}` : key;
        if (key.toLowerCase().includes(wanted)) {
          hits.push({ path: childPath, value });
        }
        if (
          typeof value === "string" &&
          value.toLowerCase().includes(wanted) &&
          !hits.some((h) => h.path === childPath)
        ) {
          hits.push({ path: childPath, value });
        }
        walk(value, childPath);
      }
    }
  };

  walk(parsed, "");
  return hits;
}