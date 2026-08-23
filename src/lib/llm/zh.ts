import { Converter } from "opencc-js";

/**
 * Traditional-Chinese hard guarantee for AI output (Hybrid Pattern).
 *
 * The LLM may write Simplified Chinese no matter how the prompt is worded,
 * so prompting alone is not enough. This deterministic OpenCC post-pass
 * converts every Chinese string in the fallback analysis to Traditional
 * Chinese (繁體中文, HK forms) BEFORE it is cached, displayed, saved to
 * Support History or exported. English/ASCII passes through untouched.
 */

const toTraditional = Converter({ from: "cn", to: "hkp" });

/** Convert any Simplified Chinese inside a string to Traditional (HK) Chinese. */
export function simplifiedToTraditional(text: string): string {
  if (!text) return text;
  return toTraditional(text);
}

/** The Chinese-bearing fields of a fallback analysis (subset of FallbackAnalysis). */
export interface TraditionalChineseLike {
  errorTypes: string[];
  rootCausesZh: string[];
  immediateInvestigationZh: string[];
  suggestedFixesZh: string[];
  longTermImprovementsZh: string[];
}

/**
 * Force every Chinese field of a fallback analysis to Traditional Chinese.
 * Idempotent: already-traditional text is returned unchanged.
 */
export function forceTraditionalAnalysis<T extends TraditionalChineseLike>(analysis: T): T {
  return {
    ...analysis,
    errorTypes: analysis.errorTypes.map(simplifiedToTraditional),
    rootCausesZh: analysis.rootCausesZh.map(simplifiedToTraditional),
    immediateInvestigationZh: analysis.immediateInvestigationZh.map(simplifiedToTraditional),
    suggestedFixesZh: analysis.suggestedFixesZh.map(simplifiedToTraditional),
    longTermImprovementsZh: analysis.longTermImprovementsZh.map(simplifiedToTraditional),
  };
}