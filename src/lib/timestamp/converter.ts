import { ToolError } from "@/lib/errors";

/**
 * Timestamp converter (section 10). Converts between Unix seconds,
 * Unix milliseconds, ISO 8601, UTC and wall-clock time in a selected IANA
 * timezone. Pure functions using only the Intl API — no external library.
 */

export const DEFAULT_TIMEZONE = "Asia/Hong_Kong";

export type ParsedAs = "unix-seconds" | "unix-milliseconds" | "iso" | "datetime";

export interface TimestampResult {
  unixSeconds: number;
  unixMilliseconds: number;
  iso8601: string;
  /** Wall clock in the selected timezone: YYYY-MM-DD HH:mm:ss */
  local: string;
  /** UTC wall clock: YYYY-MM-DD HH:mm:ss */
  utc: string;
  timezone: string;
  parsedAs: ParsedAs;
}

/** Best-effort list of IANA timezones (Node/Bun/Chromium support it). */
export function availableTimezones(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  if (typeof supported === "function") {
    const zones = supported.call(Intl, "timeZone");
    if (zones.length > 0) return zones;
  }
  return [
    "UTC",
    "Asia/Hong_Kong",
    "Asia/Shanghai",
    "Asia/Taipei",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Asia/Seoul",
    "Asia/Kolkata",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "Australia/Sydney",
    "Pacific/Auckland",
  ];
}

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Offset (ms) of an instant in a timezone, via Intl round-trip. */
function tzOffsetMs(epochMs: number, timeZone: string): number {
  const date = new Date(epochMs);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const read = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    return Number(part?.value ?? "0");
  };
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );
  return asUtc - epochMs;
}

/** Wall clock -> epoch ms, handling a DST transition by iterating to a fixed point. */
function wallClockToEpoch(clock: WallClock, timeZone: string): number {
  const asUtc = Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
  );
  // Reject impossible calendar dates (e.g. 2026-02-30) instead of letting
  // Date.UTC silently roll over.
  const probe = new Date(asUtc);
  if (
    probe.getUTCFullYear() !== clock.year ||
    probe.getUTCMonth() + 1 !== clock.month ||
    probe.getUTCDate() !== clock.day ||
    probe.getUTCHours() !== clock.hour ||
    probe.getUTCMinutes() !== clock.minute
  ) {
    throw new ToolError("Invalid timestamp.");
  }
  let epoch = asUtc - tzOffsetMs(asUtc, timeZone);
  // At DST boundaries one pass may be off; re-check until stable (max 3).
  for (let i = 0; i < 3; i++) {
    const corrected = asUtc - tzOffsetMs(epoch, timeZone);
    if (corrected === epoch) break;
    epoch = corrected;
  }
  return epoch;
}

function formatWallClock(epochMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(epochMs));
  const read = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${read("year")}-${read("month")}-${read("day")} ${read("hour")}:${read("minute")}:${read("second")}`;
}

const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

/** Parse user input into epoch milliseconds. Throws ToolError on bad input. */
export function parseTimestampMs(input: string, timezone = DEFAULT_TIMEZONE): { epochMs: number; parsedAs: ParsedAs } {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new ToolError("Please enter a timestamp.");
  }
  if (/^\d{10}$/.test(trimmed)) {
    return { epochMs: Number(trimmed) * 1000, parsedAs: "unix-seconds" };
  }
  if (/^\d{13}$/.test(trimmed)) {
    return { epochMs: Number(trimmed), parsedAs: "unix-milliseconds" };
  }
  // Naive "YYYY-MM-DD HH:mm:ss" -> wall clock in the selected timezone.
  // Checked BEFORE Date.parse because V8 also accepts this shape but treats
  // it as machine-local time, which would be wrong for this tool.
  const m = trimmed.match(DATETIME_RE);
  if (m) {
    const [, year, month, day, hour, minute, second] = m.map(Number);
    const epochMs = wallClockToEpoch(
      { year, month, day, hour, minute, second },
      timezone,
    );
    return { epochMs, parsedAs: "datetime" };
  }
  const isoMs = Date.parse(trimmed);
  if (!Number.isNaN(isoMs)) {
    return { epochMs: isoMs, parsedAs: "iso" };
  }
  throw new ToolError("Invalid timestamp.");
}

/** Full conversion of one input value. Never throws for valid input. */
export function convertTimestamp(
  input: string,
  timezone = DEFAULT_TIMEZONE,
): TimestampResult {
  const { epochMs, parsedAs } = parseTimestampMs(input, timezone);
  return {
    unixSeconds: Math.floor(epochMs / 1000),
    unixMilliseconds: epochMs,
    iso8601: new Date(epochMs).toISOString(),
    local: formatWallClock(epochMs, timezone),
    utc: formatWallClock(epochMs, "UTC"),
    timezone,
    parsedAs,
  };
}

/** Current Unix time in seconds (for the "now" button). */
export function nowUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}