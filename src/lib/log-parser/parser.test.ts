import { describe, expect, it } from "vitest";
import { extractLogInfo } from "./parser";

describe("extractLogInfo", () => {
  it("extracts timestamp, level, component, ids, exception, source and line", () => {
    const log = `2026-08-21 10:15:22 ERROR PaymentBatch transactionId=ABC123
java.lang.NullPointerException
at PaymentService.java:125`;
    const info = extractLogInfo(log);
    expect(info.timestamps).toContain("2026-08-21 10:15:22");
    expect(info.levels).toContain("ERROR");
    expect(info.components).toContain("PaymentBatch");
    expect(info.identifiers.transactionId).toBe("ABC123");
    expect(info.exceptions).toContain("NullPointerException");
    expect(info.sources[0]).toEqual({
      file: "PaymentService.java",
      line: 125,
      symbol: null,
    });
    expect(info.stackTrace).toBe(true);
  });

  it("extracts stack frames with method and class", () => {
    const log = `ERROR BatchJob
java.lang.NullPointerException
at com.example.PaymentService.process(PaymentService.java:125)
at com.example.BatchJob.run(BatchJob.java:80)`;
    const info = extractLogInfo(log);
    expect(info.sources[0]).toEqual({
      file: "PaymentService.java",
      line: 125,
      symbol: "com.example.PaymentService.process",
    });
    expect(info.sources[1]?.symbol).toBe("com.example.BatchJob.run");
    expect(info.stackTrace).toBe(true);
  });

  it("extracts all supported identifiers", () => {
    const log =
      "requestId=REQ1 traceId:TRACE2 correlationId=CORR3 sessionId=SESS4 userId=U5 transaction_id=T6";
    const info = extractLogInfo(log);
    expect(info.identifiers).toEqual({
      requestId: "REQ1",
      traceId: "TRACE2",
      correlationId: "CORR3",
      sessionId: "SESS4",
      userId: "U5",
      transaction_id: "T6",
    });
  });

  it("extracts HTTP status references (explicit and standalone)", () => {
    const info = extractLogInfo(
      "2026-08-21 10:15:22 ERROR API call failed HTTP 500 status=502\nDownstream returned 503 again http_status:503",
    );
    expect(info.httpStatuses).toEqual([500, 502, 503]);
  });

  it("extracts ISO timestamps with timezone", () => {
    const info = extractLogInfo("2026-08-21T10:15:22.123Z ERROR x");
    expect(info.timestamps).toContain("2026-08-21T10:15:22.123Z");
  });

  it("returns empty structures for empty input", () => {
    const info = extractLogInfo("");
    expect(info.timestamps).toEqual([]);
    expect(info.levels).toEqual([]);
    expect(info.components).toEqual([]);
    expect(info.identifiers).toEqual({});
    expect(info.exceptions).toEqual([]);
    expect(info.sources).toEqual([]);
  });

  it("does not treat TRACE/INFO levels as components", () => {
    const info = extractLogInfo("10:15:22 INFO started PaymentBatch");
    expect(info.levels).toEqual(["INFO"]);
    expect(info.components).not.toContain("started");
  });
});
describe("extractLogInfo — Python stack frames", () => {
  it("extracts Python File/line/in frames", () => {
    const log = `2026-08-21 10:00:00 ERROR IngestionJob
ValueError: invalid literal for int(): 'abc'
  File "/opt/app/ingest.py", line 42, in parse_row
  File "/opt/app/jobs/run.py", line 7, in main`;
    const info = extractLogInfo(log);
    expect(info.sources[0]).toEqual({
      file: "/opt/app/ingest.py",
      line: 42,
      symbol: "parse_row",
    });
    expect(info.sources[1]?.symbol).toBe("main");
    expect(info.stackTrace).toBe(true);
  });
});
