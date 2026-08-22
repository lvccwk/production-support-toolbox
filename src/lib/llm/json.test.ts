import { describe, expect, it } from "vitest";
import { extractJsonBlock, tailText } from "./json";

describe("extractJsonBlock", () => {
  it("parses plain JSON output", () => {
    expect(extractJsonBlock('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses a fenced ```json block", () => {
    expect(
      extractJsonBlock('Let me think...\n```json\n{"a":2}\n```\nDone.'),
    ).toEqual({ a: 2 });
  });

  it("parses the largest balanced JSON region with surrounding prose", () => {
    expect(extractJsonBlock('Here: {"a":3} hope that helps')).toEqual({ a: 3 });
  });

  it("returns null for non-JSON output", () => {
    expect(extractJsonBlock("no json here")).toBeNull();
    expect(extractJsonBlock("")).toBeNull();
  });
});

describe("tailText", () => {
  it("keeps short text intact", () => {
    expect(tailText("boom detail")).toBe("boom detail");
  });

  it("keeps only the tail of long text", () => {
    const long = "x".repeat(600);
    const tail = tailText(long, 100);
    expect(tail.length).toBeLessThanOrEqual(101);
    expect(tail.endsWith("x".repeat(100))).toBe(true);
  });
});