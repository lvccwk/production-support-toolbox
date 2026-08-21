import { describe, expect, it } from "vitest";
import { detectSensitiveData } from "./detector";

describe("sensitive data detection (section 17)", () => {
  it("detects common sensitive keywords", () => {
    const result = detectSensitiveData(
      "password=abc123 token=xyz authorization: Bearer abc.def.ghi api_key=K123 session=S1",
    );
    expect(result.found).toBe(true);
    for (const key of ["password", "token", "authorization", "api_key", "session", "bearer"]) {
      expect(result.matchedKeys).toContain(key);
    }
  });

  it("detects snake_case identifiers", () => {
    const result = detectSensitiveData("access_token=AT1 refresh_token=RT1 client_secret=CS1");
    expect(result.matchedKeys).toEqual(
      expect.arrayContaining(["access_token", "refresh_token", "client_secret"]),
    );
  });

  it("returns found=false for innocent text", () => {
    const result = detectSensitiveData(
      "2026-08-21 10:15:22 ERROR PaymentBatch transactionId=ABC123",
    );
    expect(result.found).toBe(false);
    expect(result.matches).toEqual([]);
  });

  it("small tokens like 'session' inside words are not flagged", () => {
    expect(detectSensitiveData("sessionId=12345").found).toBe(true); // session keyword still matches
    expect(detectSensitiveData("assessment passed").found).toBe(false);
  });
});