import { describe, expect, it } from "vitest";
import { getHttpStatus, HTTP_STATUS_CATALOG, searchHttpStatus } from "./statusCatalog";

describe("HTTP status helper (section 11)", () => {
  it("covers the required codes", () => {
    const codes = HTTP_STATUS_CATALOG.map((e) => e.code);
    for (const required of [200, 400, 401, 403, 404, 409, 429, 500, 502, 503, 504]) {
      expect(codes).toContain(required);
    }
  });

  it("searches by numeric code", () => {
    const [entry] = searchHttpStatus("503");
    expect(entry.code).toBe(503);
    expect(entry.phrase).toBe("Service Unavailable");
    expect(entry.meaning).toMatch(/temporarily unavailable/i);
    expect(entry.commonCauses).toContain("Application down");
    expect(entry.whatToCheck).toContain("Check application health.");
  });

  it("searches case-insensitively by phrase/meaning", () => {
    expect(searchHttpStatus("teapot")[0]?.code).toBe(418);
    expect(searchHttpStatus("GATEWAY TIMEOUT")[0]?.code).toBe(504);
    expect(searchHttpStatus("rate limiting")[0]?.code).toBe(429);
  });

  it("returns the full catalog for an empty query", () => {
    expect(searchHttpStatus("").length).toBe(HTTP_STATUS_CATALOG.length);
  });

  it("findByCode returns the right entry", () => {
    expect(getHttpStatus(401)?.phrase).toBe("Unauthorized");
    expect(getHttpStatus(599)).toBeUndefined();
  });
});