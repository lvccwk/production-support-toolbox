import { describe, expect, it } from "vitest";
import { normalizeLine, normalizeLog } from "./normalize";

describe("normalizeLine — token masking", () => {
  it("masks ISO timestamps with fractions and zones", () => {
    expect(normalizeLine("2026-08-21 10:15:22.123Z ERROR x")).toBe(
      "[TS] ERROR x",
    );
    expect(normalizeLine("2026-08-21T10:15:22+08:00 start")).toBe("[TS] start");
  });

  it("masks UUIDs and long hex values", () => {
    expect(normalizeLine("id=550e8400-e29b-41d4-a716-446655440000 done")).toBe(
      "id=[ID] done",
    );
    expect(
      normalizeLine(
        "hash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      ),
    ).toBe("hash [ID]");
  });

  it("masks identifier values but keeps the key", () => {
    expect(normalizeLine("ERROR transactionId=ABC123 failed")).toBe(
      "ERROR transactionId=[ID] failed",
    );
    expect(normalizeLine("ERROR request_id = REQ-42 failed")).toBe(
      "ERROR request_id=[ID] failed",
    );
  });

  it("masks URLs and IPs (with ports)", () => {
    expect(normalizeLine("GET https://api.example.com/v1/orders?q=1")).toBe(
      "GET [URL]",
    );
    expect(normalizeLine("failed to connect 10.0.0.5:5432")).toBe(
      "failed to connect [IP]",
    );
  });

  it("masks HTTP status codes as structured placeholders", () => {
    expect(normalizeLine("ERROR Request failed: HTTP 500")).toBe(
      "ERROR Request failed: HTTP [SC]",
    );
    expect(normalizeLine("ERROR status=503")).toBe("ERROR status=[SC]");
  });

  it("masks percentages, durations and plain numbers", () => {
    expect(normalizeLine("heap usage 87.5%")).toBe("heap usage [PCT]");
    expect(normalizeLine("query took 1234ms")).toBe("query took [DUR]");
    expect(normalizeLine("timeout=30s")).toBe("timeout=[DUR]");
    expect(normalizeLine("processed 42 records")).toBe("processed [N] records");
    expect(normalizeLine("version v1.2.3 BatchJob2")).toBe(
      "version v1.2.3 BatchJob2",
    );
  });

  it("trims the line", () => {
    expect(normalizeLine("  ERROR x  ")).toBe("ERROR x");
  });

  it("is idempotent", () => {
    const samples = [
      "2026-08-21 10:15:22.123Z ERROR PaymentBatch transactionId=ABC123 HTTP 500",
      "GET https://api.example.com/v1?q=1 from 10.0.0.5:5432 took 12ms",
      "INFO plain line without volatile tokens",
    ];
    for (const sample of samples) {
      const once = normalizeLine(sample);
      expect(normalizeLine(once)).toBe(once);
    }
  });
});

describe("normalizeLog", () => {
  it("normalises each line separately and keeps line boundaries", () => {
    const lines = normalizeLog(
      "2026-08-21 10:00:00 ERROR a transactionId=A1\nINFO ok 42",
    );
    expect(lines).toEqual([
      "[TS] ERROR a transactionId=[ID]",
      "INFO ok [N]",
    ]);
  });
});