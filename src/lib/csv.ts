/**
 * Spreadsheet-safe CSV cell encoding, shared by the server exports
 * (`src/lib/database/export.ts`) and the client-side dashboard report
 * (`src/lib/dashboard/reportCsv.ts`) so a downloaded CSV can never execute a
 * formula. Pure logic — safe to import from browser code.
 */
const FORMULA_TRIGGER = /^[\s\u0000-\u001f]*[=+\-@]/;

export function csvSafeCell(value: unknown): string {
  const text = String(value ?? "");
  return FORMULA_TRIGGER.test(text) ? `'${text}` : text;
}

export function csvEscape(value: unknown): string {
  return `"${csvSafeCell(value).replace(/"/g, '""')}"`;
}