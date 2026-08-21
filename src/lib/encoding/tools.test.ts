import { describe, expect, it } from "vitest";
import {
  base64Decode,
  base64Encode,
  urlDecode,
  urlEncode,
  urlEncodePath,
} from "./tools";

describe("encoding tools (section 12)", () => {
  it("base64 round-trips ASCII", () => {
    expect(base64Encode("hello world")).toBe("aGVsbG8gd29ybGQ=");
    expect(base64Decode("aGVsbG8gd29ybGQ=")).toBe("hello world");
  });

  it("base64 round-trips UTF-8 (Chinese)", () => {
    const source = "訂單 中文 ok";
    expect(base64Decode(base64Encode(source))).toBe(source);
  });

  it("rejects invalid base64", () => {
    expect(() => base64Decode("!!!not-base64!!!")).toThrowError(/Invalid base64/);
    expect(() => base64Decode("a")).toThrowError(/Invalid base64/); // length % 4 === 1
  });

  it("URL-encodes per the requirement example", () => {
    expect(urlEncode("hello world")).toBe("hello%20world");
  });

  it("URL round-trips special characters", () => {
    const source = "a=1&b=中文 語/段?q=x";
    expect(urlDecode(urlEncode(source))).toBe(source);
  });

  it("rejects invalid URL encoding", () => {
    expect(() => urlDecode("%zz")).toThrowError(/Invalid URL encoding/);
  });

  it("path encoding keeps slashes", () => {
    expect(urlEncodePath("/api/check?x=1")).toBe("/api/check?x=1");
  });

  it("survives empty input without crashing", () => {
    expect(() => base64Encode("")).toThrowError(/Empty input/i);
    expect(() => urlDecode("")).toThrowError(/Empty input/i);
  });
});