import { describe, expect, it } from "vitest";
import { validateAiAnalysis } from "./schema";

const VALID = {
  severity: "High",
  errorTypes: ["NullPointerException"],
  rootCause: "A null value was dereferenced.",
  rootCauseZh: "空值被解除引用。",
  evidenceLines: [2, 3],
  nextSteps: ["Validate input", "Check caller"],
  nextStepsZh: ["驗證輸入", "檢查呼叫端"],
  confidence: 0.8,
  explanation: "Evidence line 2 shows the NPE.",
  explanationZh: "證據第 2 行顯示 NPE。",
};

describe("validateAiAnalysis", () => {
  it("accepts a valid analysis and normalises text", () => {
    const result = validateAiAnalysis({
      ...VALID,
      rootCause: "  padded cause  ",
      nextSteps: [" step one ", ""],
    });
    expect(result).not.toBeNull();
    expect(result?.rootCause).toBe("padded cause");
    expect(result?.nextSteps).toEqual(["step one"]);
  });

  it("rejects missing or invalid severity", () => {
    expect(validateAiAnalysis({ ...VALID, severity: "Urgent" })).toBeNull();
    expect(validateAiAnalysis({ ...VALID, severity: undefined })).toBeNull();
  });

  it("rejects non-array or wrongly-typed fields", () => {
    expect(validateAiAnalysis({ ...VALID, errorTypes: "NPE" })).toBeNull();
    expect(validateAiAnalysis({ ...VALID, nextSteps: [42] })).toBeNull();
    expect(validateAiAnalysis({ ...VALID, evidenceLines: [0] })).toBeNull();
    expect(validateAiAnalysis({ ...VALID, evidenceLines: [1.5] })).toBeNull();
    expect(validateAiAnalysis({ ...VALID, confidence: 1.2 })).toBeNull();
    expect(validateAiAnalysis({ ...VALID, confidence: "high" })).toBeNull();
  });

  it("rejects empty root cause and non-objects", () => {
    expect(validateAiAnalysis({ ...VALID, rootCause: "  " })).toBeNull();
    expect(validateAiAnalysis(null)).toBeNull();
    expect(validateAiAnalysis([VALID])).toBeNull();
    expect(validateAiAnalysis("json")).toBeNull();
  });

  it("requires the Chinese root cause and next steps", () => {
    expect(validateAiAnalysis({ ...VALID, rootCauseZh: "  " })).toBeNull();
    expect(validateAiAnalysis({ ...VALID, rootCauseZh: undefined })).toBeNull();
    expect(validateAiAnalysis({ ...VALID, nextStepsZh: "not an array" })).toBeNull();
  });

  it("allows omitting the Chinese explanation (falls back to English)", () => {
    const result = validateAiAnalysis({
      ...VALID,
      explanationZh: undefined,
    });
    expect(result?.explanationZh).toBe("");
  });

  it("caps evidence lines but keeps the first ones", () => {
    const big = Array.from({ length: 30 }, (_, i) => i + 1);
    const result = validateAiAnalysis({ ...VALID, evidenceLines: big });
    expect(result?.evidenceLines).toHaveLength(20);
  });
});