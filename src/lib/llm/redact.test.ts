import { describe, expect, it } from "vitest";
import {
  hasSensitiveWordMentions,
  redactSensitiveValues,
} from "./redact";

describe("redactSensitiveValues", () => {
  it("masks password values in key=value form", () => {
    const result = redactSensitiveValues(
      "ERROR login failed password=abc123 host=svr1",
    );
    expect(result.text).toBe(
      "ERROR login failed password=[REDACTED:password] host=svr1",
    );
    expect(result.maskedKeys).toContain("password");
  });

  it("masks : and spaced forms and tracks each key", () => {
    const result = redactSensitiveValues(
      "config: token = secretXYZ\napi_key: abcdef",
    );
    expect(result.text).toContain("token = [REDACTED:token]");
    expect(result.text).toContain("api_key: [REDACTED:api_key]");
    expect(result.maskedKeys).toEqual(["api_key", "token"]);
  });

  it("masks Authorization/Bearer header values without leaving the token", () => {
    const result = redactSensitiveValues(
      "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.token rest",
    );
    expect(result.text).toContain("Authorization: [REDACTED:authorization]");
    expect(result.text).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(result.maskedKeys).toContain("authorization");
  });

  it("masks Basic scheme values", () => {
    const result = redactSensitiveValues("Authorization: Basic dXNlcjpwYXNz");
    expect(result.text).toBe("Authorization: [REDACTED:authorization]");
    expect(result.text).not.toContain("dXNlcjpwYXNz");
  });

  it("masks secrets inside JSON-ish text", () => {
    const result = redactSensitiveValues('{"client_secret":"s3cr3t","scope":"x"}');
    expect(result.text).toContain('"client_secret":"[REDACTED:client_secret]"');
    expect(result.text).not.toContain("s3cr3t");
  });

  it("leaves word-only mentions untouched (warning, not auto-mask)", () => {
    const result = redactSensitiveValues(
      "ERROR missing password field in config",
    );
    expect(result.text).toBe("ERROR missing password field in config");
    expect(result.maskedKeys).toEqual([]);
  });

  it("is idempotent", () => {
    const sample =
      "ERROR token=abc password='x' Authorization: Bearer 1234567890abc";
    const once = redactSensitiveValues(sample);
    const twice = redactSensitiveValues(once.text);
    expect(twice.text).toBe(once.text);
  });

  it("does not mask unrelated tokens (transactionId value stays)", () => {
    const result = redactSensitiveValues(
      "ERROR transactionId=ABC123 processed",
    );
    // transactionId is not a secret key; the API layer masks ids separately.
    expect(result.text).toBe("ERROR transactionId=ABC123 processed");
  });
});

describe("hasSensitiveWordMentions", () => {
  it("warns on residual keyword mentions", () => {
    expect(
      hasSensitiveWordMentions("ERROR something with password"),
    ).toBe(true);
    expect(hasSensitiveWordMentions("ERROR nothing here")).toBe(false);
  });
});