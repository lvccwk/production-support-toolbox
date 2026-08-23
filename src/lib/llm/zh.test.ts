import { describe, expect, it } from "vitest";
import { forceTraditionalAnalysis, simplifiedToTraditional } from "./zh";

describe("simplifiedToTraditional", () => {
  it("converts simplified Chinese characters to traditional", () => {
    expect(simplifiedToTraditional("问题分析建议")).toBe("問題分析建議");
    expect(simplifiedToTraditional("永远不要输出简体字")).toBe("永遠不要輸出簡體字");
  });

  it("converts simplified phrases to HK traditional forms", () => {
    expect(simplifiedToTraditional("请检查服务器日志")).toBe("請檢查伺服器日誌");
    expect(simplifiedToTraditional("服务器连接超时")).toBe("伺服器連接超時");
    expect(simplifiedToTraditional("未知子系统")).toBe("未知子系統");
  });

  it("leaves already-traditional text and ASCII untouched", () => {
    expect(simplifiedToTraditional("問題分析建議")).toBe("問題分析建議");
    expect(simplifiedToTraditional("PaymentBatch java.lang.NullPointerException")).toBe(
      "PaymentBatch java.lang.NullPointerException",
    );
  });

  it("handles empty input", () => {
    expect(simplifiedToTraditional("")).toBe("");
  });
});

describe("context-aware one-to-many variants (merged characters)", () => {
  // Simplified merged several traditional characters into one glyph; the hkp
  // phrase dictionary picks the right variant from context. These cases pin
  // that behaviour so a dictionary upgrade cannot silently regress it.
  it("发 -> 發/髮 by context", () => {
    expect(simplifiedToTraditional("出发发现开发")).toBe("出發發現開發");
    expect(simplifiedToTraditional("头发理发")).toBe("頭髮理髮");
  });

  it("后 -> 後/后 by context", () => {
    expect(simplifiedToTraditional("后面以后")).toBe("後面以後");
    expect(simplifiedToTraditional("皇后术后")).toBe("皇后術後");
  });

  it("干 -> 乾/幹/干 by context", () => {
    expect(simplifiedToTraditional("干净")).toBe("乾淨");
    expect(simplifiedToTraditional("干部")).toBe("幹部");
    expect(simplifiedToTraditional("干杯")).toBe("乾杯");
    expect(simplifiedToTraditional("树干")).toBe("樹幹");
  });

  it("系 -> 係/繫/系 by context", () => {
    expect(simplifiedToTraditional("关系联系")).toBe("關係聯繫");
    expect(simplifiedToTraditional("系统系列")).toBe("系統系列");
  });

  it("里 -> 裏/里 by context", () => {
    expect(simplifiedToTraditional("里面")).toBe("裏面");
    expect(simplifiedToTraditional("公里邻里")).toBe("公里鄰里");
  });

  it("台 -> 臺/檯/颱/台 by context", () => {
    expect(simplifiedToTraditional("台湾")).toBe("台灣");
    expect(simplifiedToTraditional("台风")).toBe("颱風");
    expect(simplifiedToTraditional("台灯")).toBe("枱燈");
    expect(simplifiedToTraditional("舞台电台")).toBe("舞台電台");
  });

  it("面 -> 麵/面 by context", () => {
    expect(simplifiedToTraditional("面包")).toBe("麪包");
    expect(simplifiedToTraditional("面试面积")).toBe("面試面積");
  });

  it("chars identical in both scripts pass through as-is", () => {
    expect(simplifiedToTraditional("人民中国文明")).toBe("人民中國文明");
  });
});

describe("forceTraditionalAnalysis", () => {
  it("converts every Chinese-bearing field", () => {
    const out = forceTraditionalAnalysis({
      severity: "High",
      errorTypes: ["连接超时"],
      rootCauses: ["gateway timeout"],
      rootCausesZh: ["服务器连接超时"],
      immediateInvestigation: ["check logs"],
      immediateInvestigationZh: ["检查服务器日志"],
      suggestedFixes: ["restart"],
      suggestedFixesZh: ["重启服务"],
      longTermImprovements: ["add monitoring"],
      longTermImprovementsZh: ["增加监控"],
      confidence: 0.5,
    });
    expect(out.errorTypes).toEqual(["連接超時"]);
    expect(out.rootCausesZh).toEqual(["伺服器連接超時"]);
    expect(out.immediateInvestigationZh).toEqual(["檢查伺服器日誌"]);
    expect(out.suggestedFixesZh).toEqual(["重啓服務"]);
    expect(out.longTermImprovementsZh).toEqual(["增加監控"]);
    // English fields are not touched.
    expect(out.rootCauses).toEqual(["gateway timeout"]);
  });

  it("is idempotent on already-traditional text", () => {
    const zh = ["問題分析建議", "檢查伺服器日誌"];
    const once = forceTraditionalAnalysis({
      errorTypes: [],
      rootCausesZh: zh,
      immediateInvestigationZh: zh,
      suggestedFixesZh: zh,
      longTermImprovementsZh: zh,
    });
    // errorTypes is part of the shape; unit-tested type here is structurally
    // the subset — rerun the pass and confirm no further change.
    const twice = forceTraditionalAnalysis(once);
    expect(twice.rootCausesZh).toEqual(zh);
    expect(twice.suggestedFixesZh).toEqual(zh);
  });
});