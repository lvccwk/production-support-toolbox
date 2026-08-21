import { describe, expect, it } from "vitest";
import { formatJson, minifyJson, searchJson, validateJson } from "./jsonTools";
import { ToolError } from "@/lib/errors";

describe("JSON toolbox (section 8)", () => {
  it("validates valid JSON", () => {
    expect(validateJson('{"name":"ABC","status":"ERROR"}')).toEqual({
      valid: true,
      error: null,
      position: null,
    });
  });

  it("validates invalid JSON with error and position", () => {
    const result = validateJson('{"name":"ABC",}');
    expect(result.valid).toBe(false);
    expect(result.error).not.toBeNull();
  });

  it("formats JSON", () => {
    expect(formatJson('{"name":"ABC","status":"ERROR"}')).toBe(
      '{\n  "name": "ABC",\n  "status": "ERROR"\n}',
    );
  });

  it("throws friendly error for invalid JSON", () => {
    expect(() => formatJson("{nope")).toThrowError("Invalid JSON. Please check syntax.");
  });

  it("minifies formatted JSON into one line", () => {
    const formatted = formatJson('{"a":1,"b":[1,2]}');
    expect(minifyJson(formatted)).toBe('{"a":1,"b":[1,2]}');
  });

  it("searches keys case-insensitively", () => {
    const hits = searchJson(
      '{"transactionId":"ABC123","status":"ERROR","nested":{"errorCode":"E42","status":"OK"}}',
      "status",
    );
    expect(hits.length).toBe(2);
    expect(hits.some((h) => h.path === "status")).toBe(true);
    expect(hits.some((h) => h.path === "nested.status")).toBe(true);
  });

  it("searches values as fallback", () => {
    const hits = searchJson('{"message":"payment failed","code":1}', "failed");
    expect(hits.some((h) => h.path === "message" && h.value === "payment failed")).toBe(true);
  });

  it("rejects empty search queries", () => {
    expect(() => searchJson("{}", "   ")).toThrowError();
  });

  it("survives empty input without crashing", () => {
    expect(() => formatJson("")).toThrowError(ToolError);
    expect(() => minifyJson("  ")).toThrowError(ToolError);
  });
});