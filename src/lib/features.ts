/**
 * 暫時停用嘅功能開關（2026-08 起）。
 * Temporarily disabled features — 一個位置控制，清空 array 即全部恢復：
 *
 * - GUI：呢啲 id 唔會喺側邊欄 / 手機選擇器出現（hash 直入仍可開到，資料唔受影響）
 * - Agent：`GET /api/tools` manifest 唔會列出呢啲 tool
 *
 * API endpoints、OpenAPI 文檔、歷史記錄嘅 label 全部原封不動 —— 純粹係
 * 「收埋唔俾你見到」，唔係移除，隨時可以翻生。
 */
export const DISABLED_FEATURES: readonly string[] = ["alerts", "timestamp", "encoding"];