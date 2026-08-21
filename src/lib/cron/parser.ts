import { ToolError } from "@/lib/errors";
import type { CronDescription, CronField } from "@/types";

/**
 * Cron expression helper (section 13). Supports standard 5-field cron:
 * minute hour day-of-month month day-of-week, with `*`, lists, ranges and
 * steps. Pure logic — no external dependency.
 */

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DOW_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

const DOW_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function parseCronField(
  raw: string,
  min: number,
  max: number,
  names: Record<string, number> | null,
  normalize?: (value: number) => number,
): CronField {
  if (!raw) throw new ToolError("Invalid cron expression.");
  if (raw === "*") return { raw, values: null };

  if (raw.startsWith("*/")) {
    const step = Number(raw.slice(2));
    if (!Number.isInteger(step) || step < 1 || step > max - min + 1) {
      throw new ToolError("Invalid cron expression.");
    }
    const values: number[] = [];
    for (let v = min; v <= max; v += step) values.push(normalize ? normalize(v) : v);
    return { raw, values };
  }

  const values = new Set<number>();
  for (const item of raw.split(",")) {
    const [base, stepRaw] = item.split("/");
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1) throw new ToolError("Invalid cron expression.");

    let start: number;
    let end: number;
    if (base === "*") {
      start = min;
      end = max;
    } else {
      const range = base.split("-");
      const resolve = (token: string): number => {
        const named = names ? names[token.toLowerCase()] : undefined;
        if (named !== undefined) return named;
        const n = Number(token);
        if (!Number.isInteger(n)) throw new ToolError("Invalid cron expression.");
        return n;
      };
      start = resolve(range[0]);
      end = range.length > 1 ? resolve(range[1]) : start;
    }
    if (start > end) {
      // Wrapping ranges (e.g. fri-mon) are not supported for v1.
      throw new ToolError("Invalid cron expression.");
    }
    for (let value = start; value <= end; value += step) {
      if (value < min || value > max) throw new ToolError("Invalid cron expression.");
      const normalized = normalize ? normalize(value) : value;
      if (normalized < min || normalized > max) continue;
      values.add(normalized);
    }
  }
  if (values.size === 0) throw new ToolError("Invalid cron expression.");
  return { raw, values: [...values].sort((a, b) => a - b) };
}

export interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dom: CronField;
  month: CronField;
  dow: CronField;
}

export function parseCron(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5 || expression.trim().length === 0) {
    throw new ToolError("Invalid cron expression.");
  }
  const [minute, hour, dom, month, dow] = parts;
  return {
    minute: parseCronField(minute, 0, 59, null),
    hour: parseCronField(hour, 0, 23, null),
    dom: parseCronField(dom, 1, 31, null),
    month: parseCronField(month, 1, 12, MONTH_NAMES),
    dow: parseCronField(dow, 0, 7, DOW_NAMES, (value) => (value === 7 ? 0 : value)),
  };
}

function fieldMatches(field: CronField, value: number): boolean {
  return field.values === null || field.values.includes(value);
}

export function cronMatches(cron: ParsedCron, date: Date): boolean {
  const minuteOk = fieldMatches(cron.minute, date.getMinutes());
  const hourOk = fieldMatches(cron.hour, date.getHours());
  const monthOk = fieldMatches(cron.month, date.getMonth() + 1);

  const domRestricted = cron.dom.values !== null;
  const dowRestricted = cron.dow.values !== null;
  const domOk = !domRestricted || cron.dom.values!.includes(date.getDate());
  const dowOk = !dowRestricted || cron.dow.values!.includes(date.getDay());

  // Standard cron rule: when both day-of-month and day-of-week are
  // restricted, the day matches if EITHER matches.
  const dayOk =
    domRestricted && dowRestricted ? domOk || dowOk : domOk && dowOk;

  return minuteOk && hourOk && monthOk && dayOk;
}

const MAX_MINUTE_SCAN = 3_000_000; // ~5.7 years, enough for any realistic cron

export function nextRuns(
  cron: ParsedCron,
  from: Date,
  count = 5,
): Date[] {
  const runs: Date[] = [];
  const start = new Date(from.getTime());
  start.setSeconds(0, 0);
  const candidate = new Date(start.getTime() + 60_000);
  let iterations = 0;
  while (runs.length < count && iterations < MAX_MINUTE_SCAN) {
    if (cronMatches(cron, candidate)) {
      runs.push(new Date(candidate.getTime()));
    }
    candidate.setTime(candidate.getTime() + 60_000);
    iterations += 1;
  }
  return runs;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Human-readable time part, e.g. "at 08:00", "at minute 30 past every hour". */
function describeTime(cron: ParsedCron): string {
  const { minute, hour } = cron;
  if (minute.values === null && hour.values === null) return "every minute";
  if (minute.values !== null && hour.values !== null) {
    if (minute.values.length === 1 && hour.values.length === 1) {
      return `at ${pad2(hour.values[0])}:${pad2(minute.values[0])}`;
    }
    const times: string[] = [];
    for (const h of hour.values) {
      for (const m of minute.values) times.push(`${pad2(h)}:${pad2(m)}`);
    }
    return `at ${times.join(", ")}`;
  }
  if (hour.values === null) {
    return `at minute ${minute.values!.join(", ")} past every hour`;
  }
  return `at minute 0-59 of hour(s) ${hour.values!.map(pad2).join(", ")}`;
}

/** Human description: "0 8 * * *" -> "Runs every day at 08:00." */
export function describeCron(expression: string): string {
  const cron = parseCron(expression);

  const dayParts: string[] = [];
  if (cron.month.values !== null) {
    dayParts.push(
      cron.month.values!.length === 1
        ? `in ${MONTH_LABELS[cron.month.values![0] - 1]}`
        : `in ${cron.month.values!.map((m) => MONTH_LABELS[m - 1]).join(", ")}`,
    );
  }
  if (cron.dom.values === null && cron.dow.values === null) {
    dayParts.push("every day");
  } else {
    const dom = cron.dom.values;
    const dow = cron.dow.values;
    if (dom !== null && dom.length === 1) {
      dayParts.push(`on day-of-month ${dom[0]}`);
    } else if (dom !== null) {
      dayParts.push(`on day-of-month ${dom.join(", ")}`);
    }
    if (dow !== null && dow.length === 1) {
      dayParts.push(`on ${DOW_LABELS[dow[0]]}`);
    } else if (dow !== null && isConsecutive(dow) && dow.length > 1) {
      dayParts.push(`${DOW_LABELS[dow[0]]} through ${DOW_LABELS[dow[dow.length - 1]]}`);
    } else if (dow !== null) {
      dayParts.push(`on ${dow.map((d) => DOW_LABELS[d]).join(", ")}`);
    }
  }

  const time = describeTime(cron);
  if (time === "every minute") return "Runs every minute.";

  const human = `Runs ${dayParts.join(" ")} ${time}.`.replace(/\s+/g, " ").trim();
  return human.charAt(0).toUpperCase() + human.slice(1);
}

function isConsecutive(values: number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== values[i - 1] + 1) return false;
  }
  return true;
}

/** Full helper result: description + next 5 run times (RFC 3339, local). */
export function cronHelper(expression: string, now = new Date()): CronDescription {
  if (!expression.trim()) {
    throw new ToolError("Please enter a cron expression.");
  }
  const cron = parseCron(expression);
  const runs = nextRuns(cron, now, 5);
  return {
    expression: expression.trim(),
    human: describeCron(expression),
    nextRuns: runs.map((r) => r.toISOString()),
    nextRunsUnix: runs.map((r) => Math.floor(r.getTime() / 1000)),
  };
}