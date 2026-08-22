import { describe, expect, it } from "vitest";
import {
  buildAnalysisSystemPrompt,
  buildAnalysisUserPrompt,
  selectContextLines,
} from "./prompts";
import type { ExtractedLogInfo, LogAnalysis } from "@/types";

const INFO: ExtractedLogInfo = {
  timestamps: ["2026-08-21 10:15:22"],
  levels: ["ERROR"],
  components: ["PaymentBatch"],
  identifiers: { transactionId: "ABC123", userId: "u-42" },
  exceptions: ["NullPointerException"],
  sources: [
    { file: "PaymentService.java", line: 125, symbol: "com.example.PaymentService.process" },
  ],
  httpStatuses: [500],
  stackTrace: true,
};

const ANALYSIS: LogAnalysis = {
  severity: "High",
  errorTypes: ["NullPointerException"],
  affectedComponents: ["PaymentBatch"],
  rootCauses: ["A null object reference was dereferenced."],
  immediateInvestigation: ["Identify the exact class and line number."],
  suggestedFixes: ["Add null validation."],
  longTermImprovements: ["Add defensive validation."],
  matchedRuleIds: ["null-pointer"],
  matchedEvidence: [],
  unknownTriage: null,
};

describe("prompt construction", () => {
  it("includes structured facts, rule result and evidence", () => {
    const prompt = buildAnalysisUserPrompt({
      tool: "log-analyzer",
      info: INFO,
      analysis: ANALYSIS,
      evidence: [
        {
          ruleId: "null-pointer",
          ruleName: "NullPointerException",
          lines: [
            { line: 2, text: "java.lang.NullPointerException" },
            { line: 3, text: "at PaymentService.java:125" },
          ],
        },
      ],
    });
    expect(prompt).toContain('"tool": "log-analyzer"');
    expect(prompt).toContain("NullPointerException");
    expect(prompt).toContain("null-pointer");
    expect(prompt).toContain("L2: java.lang.NullPointerException");
    expect(prompt).toContain("L3: at PaymentService.java:125");
  });

  it("masks identifier values before sending", () => {
    const prompt = buildAnalysisUserPrompt({
      tool: "log-analyzer",
      info: INFO,
      analysis: ANALYSIS,
      evidence: [],
    });
    expect(prompt).not.toContain("ABC123");
    expect(prompt).not.toContain("u-42");
    expect(prompt).toContain('"transactionId": "[ID]"');
  });

  it("instructs JSON-only output and evidence citation", () => {
    const system = buildAnalysisSystemPrompt();
    expect(system).toContain("Output ONLY a JSON object");
    expect(system).toContain("evidenceLines");
    expect(system).toContain("never invent");
  });
});

describe("selectContextLines", () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");

  it("keeps head, tail and evidence neighbourhoods", () => {
    const out = selectContextLines(lines, [50, 51]);
    const labels = out.map((l) => Number(l.match(/L(\d+)/)?.[1]));
    expect(labels[0]).toBe(1);
    expect(labels).toContain(10);
    expect(labels).toContain(81); // tail start (100 - 20 + 1)
    expect(labels).toContain(47); // 50 - 3
    expect(labels).toContain(53); // 51 + 3
    expect(labels).toContain(100);
  });

  it("respects the char cap", () => {
    const small = selectContextLines(lines, [], { maxChars: 200 });
    expect(small.join("\n").length).toBeLessThanOrEqual(250);
    expect(small.length).toBeGreaterThan(1);
  });

  it("is deterministic", () => {
    expect(selectContextLines(lines, [50])).toEqual(
      selectContextLines(lines, [50]),
    );
  });
});