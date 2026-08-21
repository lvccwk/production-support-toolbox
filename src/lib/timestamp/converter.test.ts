import { describe, expect, it } from "vitest";
import { convertTimestamp, DEFAULT_TIMEZONE, parseTimestampMs } from "./converter";
import { ToolError } from "@/lib/errors";

describe("timestamp converter (section 10 & 21)", () => {
  it("converts the requirement example accurately (Asia/Hong_Kong)", () => {
    // 1787299200 -> 2026-08-21 08:00:00 UTC -> 2026-08-21 16:00:00 Asia/Hong_Kong
    const result = convertTimestamp("1787299200", DEFAULT_TIMEZONE);
    expect(result.parsedAs).toBe("unix-seconds");
    expect(result.unixSeconds).toBe(1787299200);
    expect(result.utc).toBe("2026-08-21 08:00:00");
    expect(result.local).toBe("2026-08-21 16:00:00");
    expect(result.iso8601).toBe("2026-08-21T08:00:00.000Z");
  });

  it("accepts 13-digit Unix milliseconds", () => {
    const result = convertTimestamp("1787299200000", DEFAULT_TIMEZONE);
    expect(result.parsedAs).toBe("unix-milliseconds");
    expect(result.unixMilliseconds).toBe(1787299200000);
  });

  it("accepts ISO 8601 with Z and offsets", () => {
    expect(convertTimestamp("2026-08-21T08:00:00.000Z").utc).toBe("2026-08-21 08:00:00");
    expect(convertTimestamp("2026-08-21T16:00:00+08:00").utc).toBe("2026-08-21 08:00:00");
  });

  it("treats naive datetimes as wall clock in the selected timezone", () => {
    const result = convertTimestamp("2026-08-21 16:00:00", DEFAULT_TIMEZONE);
    expect(result.parsedAs).toBe("datetime");
    expect(result.utc).toBe("2026-08-21 08:00:00");
  });

  it("round-trips in other timezones (Asia/Tokyo)", () => {
    const result = convertTimestamp("2026-08-21 09:30:00", "Asia/Tokyo");
    expect(result.utc).toBe("2026-08-21 00:30:00");
    expect(result.local).toBe("2026-08-21 09:30:00");
  });

  it("rejects invalid timestamps with the required message", () => {
    expect(() => convertTimestamp("not-a-time")).toThrowError(/Invalid timestamp/);
    expect(() => parseTimestampMs("\t ")).toThrowError(ToolError);
  });

  it("rejects out-of-range clock values", () => {
    expect(() => convertTimestamp("2026-02-30 12:00:00")).toThrowError(/Invalid timestamp/);
  });
});