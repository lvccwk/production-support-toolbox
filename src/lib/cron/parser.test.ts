import { describe, expect, it } from "vitest";
import { cronHelper, cronMatches, nextRuns, parseCron } from "./parser";

describe("cron helper (section 13 & 21)", () => {
  it("describes the requirement example", () => {
    expect(cronHelper("0 8 * * *").human).toBe("Runs every day at 08:00.");
  });

  it("computes next 5 runs for a daily cron", () => {
    const cron = parseCron("0 8 * * *");
    const from = new Date(2026, 7, 21, 7, 30, 0); // local 2026-08-21 07:30
    const runs = nextRuns(cron, from, 5);
    expect(runs).toHaveLength(5);
    expect(runs[0].getTime()).toBe(new Date(2026, 7, 21, 8, 0, 0).getTime());
    expect(runs[1].getTime()).toBe(new Date(2026, 7, 22, 8, 0, 0).getTime());
  });

  it("supports step expressions (*/15)", () => {
    const cron = parseCron("*/15 * * * *");
    const from = new Date(2026, 7, 21, 10, 2, 0);
    const runs = nextRuns(cron, from, 3).map((d) => d.getMinutes());
    expect(runs).toEqual([15, 30, 45]);
  });

  it("supports ranges and weekdays (Mon-Fri 09:00)", () => {
    const cron = parseCron("0 9 * * 1-5");
    // 2026-08-21 is a Friday: next run today; then Monday 24.
    const from = new Date(2026, 7, 21, 8, 0, 0);
    const runs = nextRuns(cron, from, 2);
    expect(runs[0].getTime()).toBe(new Date(2026, 7, 21, 9, 0, 0).getTime());
    expect(runs[1].getTime()).toBe(new Date(2026, 7, 24, 9, 0, 0).getTime());
  });

  it("applies the standard dom/dow OR rule for restricted fields", () => {
    // Restricted dom + dow: runs when EITHER matches.
    const cron = parseCron("0 0 1 * 0");
    expect(cronMatches(cron, new Date(2026, 7, 1, 0, 0))).toBe(true); // dom 1 (Saturday)
    expect(cronMatches(cron, new Date(2026, 7, 2, 0, 0))).toBe(true); // Sunday
    expect(cronMatches(cron, new Date(2026, 7, 3, 0, 0))).toBe(false); // Monday
  });

  it("rejects invalid expressions", () => {
    for (const bad of [
      "61 * * * *", // minute out of range
      "0 24 * * *", // hour out of range
      "0 0 32 * *", // day-of-month out of range
      "0 0 * 13 *", // month out of range
      "a b c d e", // non-numeric
      "0 8 * *", // only 4 fields
      "* * * * * *", // 6 fields
      "", // empty
    ]) {
      expect(() => parseCron(bad)).toThrowError(/Invalid cron expression/);
    }
  });

  it("normalises day-of-week 7 to 0", () => {
    const cron = parseCron("0 8 * * 7");
    expect(cron.dow.values).toEqual([0]);
  });

  it("every run produced by nextRuns actually matches", () => {
    const cron = parseCron("5 4 * * 2");
    const from = new Date(2026, 7, 21, 0, 0, 0);
    for (const run of nextRuns(cron, from, 5)) {
      expect(cronMatches(cron, run)).toBe(true);
    }
  });
});