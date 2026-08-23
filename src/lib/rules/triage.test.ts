import { describe, expect, it } from "vitest";
import { triageUnknownError } from "./triage";
import type { ExtractedLogInfo } from "@/types";

function info(partial: Partial<ExtractedLogInfo>): ExtractedLogInfo {
  return {
    timestamps: [],
    levels: [],
    components: [],
    identifiers: {},
    exceptions: [],
    sources: [],
    httpStatuses: [],
    stackTrace: false,
    ...partial,
  };
}

describe("unknown-error triage", () => {
  it("maps ValueError to a data-type hint", () => {
    const result = triageUnknownError(info({ exceptions: ["ValueError"] }));
    expect(
      result.causes.some((c) => /wrong type or format/i.test(c)),
    ).toBe(true);
    expect(
      result.investigation.some((s) => /field or value/i.test(s)),
    ).toBe(true);
  });

  it("maps the NPE abbreviation to a null-value hint", () => {
    const result = triageUnknownError(info({ exceptions: ["NPE"] }));
    expect(
      result.causes.some((c) => /null or undefined/i.test(c)),
    ).toBe(true);
  });

  it("deduplicates hints by label across exception classes", () => {
    const result = triageUnknownError(
      info({ exceptions: ["NumberFormatException", "ValueError"] }),
    );
    const dataTypeCauses = result.causes.filter((c) =>
      /wrong type or format/i.test(c),
    );
    expect(dataTypeCauses).toHaveLength(1);
  });

  it("derives a language hint from source file extensions", () => {
    const result = triageUnknownError(
      info({ sources: [{ file: "ingest.py", line: 42, symbol: null }] }),
    );
    expect(result.languageHint).toBe("Python");
  });

  it("derives client direction from 4xx only", () => {
    expect(
      triageUnknownError(info({ httpStatuses: [403] })).httpDirection,
    ).toBe("client");
  });

  it("derives server direction from any 5xx, even with 4xx present", () => {
    expect(
      triageUnknownError(info({ httpStatuses: [403, 503] })).httpDirection,
    ).toBe("server");
  });

  it("adds a stack-trace hint when a stack trace is present", () => {
    const result = triageUnknownError(
      info({ exceptions: ["BizarreException"], stackTrace: true }),
    );
    expect(
      result.investigation.some((s) => /first stack frame/i.test(s)),
    ).toBe(true);
  });

  it("falls back to baseline sentences when nothing can be derived", () => {
    const result = triageUnknownError(info({}));
    expect(result.causes).toHaveLength(1);
    expect(result.investigation).toHaveLength(1);
    expect(result.languageHint).toBeNull();
    expect(result.httpDirection).toBeNull();
  });

  it("skips the generic catch-all when specific hints exist", () => {
    const result = triageUnknownError(
      info({ exceptions: ["ValueError", "WhateverException"] }),
    );
    expect(
      result.causes.some((c) => /generic exception/i.test(c)),
    ).toBe(false);
    expect(
      result.causes.some((c) => /wrong type or format/i.test(c)),
    ).toBe(true);
  });

  it("returns Traditional Chinese guidance alongside English", () => {
    const result = triageUnknownError(
      info({ exceptions: ["ValueError"], sources: [{ file: "app.py", line: 10, symbol: null }] }),
    );
    expect(result.causesZh).toBeDefined();
    expect(result.causesZh!.length).toBe(result.causes.length);
    expect(result.investigationZh!.length).toBe(result.investigation.length);
  });
});