# 規劃書:精準化 + LLM 增強(OpenCode 優先)

**Production Support Toolbox v1.1 → v2.0**
**版本:** 2.0(整合 OpenCode 定案版)　**日期:** 2026-08-22

---

## 1. 背景與目標

v1 已完成度高、定位(本地優先、數據不外送)是核心賣點,但有三個結構性問題限制了「每天實際價值」,加上新需求(更精準的答案):

| # | 問題 | 代碼現況 | 後果 |
| --- | --- | --- | --- |
| P-A | 規則引擎覆蓋率低(10 條)+ 建議有模板噪音 | `engine.ts:18-24` 的 `GENERIC_INVESTIGATION` **無條件**附加到每次分析;fallback 只有 3 句死板文字 | 真實 log 大半落入 "Unknown Error",建議淪為廢話,削弱可信度 |
| P-B | Log Comparison 用原始 LCS 逐行比對 | `comparator.ts:43-76` 直接 diff 原始行 | timestamp / requestId / 數字欄位必然變動 → 兩份 log 幾乎每行都被標為新增/移除,輸出被雜訊淹沒 |
| P-C | 無匯出/備份,資料鎖死在單一 SQLite | `db.ts` 只有 incidents/history 兩表 | 支援紀錄是資產,無備份即風險 |
| P-D | (新需求)答案更精準 → 接 LLM | 目前無任何 AI 能力 | — |

**本規劃書目標:** 在不破壞 local-first 賣點的前提下,(1) 把確定性層做精、(2) 以**可選、受控、可追溯**的方式透過 **OpenCode** 接駁 LLM,讓「回答更精準」來自「結構化事實 + 證據引用 + 格式約束」,而不是盲目相信模型。

---

## 2. 接駁方式:OpenCode 優先(已定案)

### 2.1 可以接 LLM API 嗎?——可以,而且已選定 OpenCode

**決策:** v2.0 統一透過 **OpenCode**(開源編程代理,https://opencode.ai)接駁模型,而不是直接寫各家 API client。

選它的理由:

| 考量 | 說明 |
| --- | --- |
| 一個整合,全部模型 | OpenCode 已內建支援 Anthropic / OpenAI / DeepSeek / OpenRouter / 本地 Ollama 等 provider;工具箱只需要學會「呼叫 OpenCode」一種方式 |
| 金鑰管理集中 | API key 由 OpenCode 自己的 auth 機制(`opencode auth login` 或環境變數)管理,工具箱不需要實作各家金鑰格式 |
| 保留隱私選項 | 用戶若配置本地 Ollama,數據依然零外送 |
| 現成 CLI | `opencode run`(非互動模式)可直接從 Node 子進程呼叫 |

注意定位差異:OpenCode **本身不是 LLM API 伺服器**,它是會跑 agent loop 的代理工具——這帶來兩面性(見 §7.6 安全與 §7.3 延遲管理),但對本工具的使用情境(偶發、用戶主動觸發、需要推理的分析)是合適的。

### 2.2 三條整合路徑(按優先序)

| 路徑 | 做法 | 優點 | 缺點 | 建議 |
| --- | --- | --- | --- | --- |
| **A. CLI 子進程(首選)** | 伺服器端 spawn `opencode run "<prompt>"`,解析輸出 | 最簡單、與版本無關、可完全控制超時/殺進程 | 需要本機安裝 opencode;輸出解析要相容 CLI 格式 | **v2.0 採用** |
| B. TypeScript SDK | 用 `@opencode-ai/sdk` 連 OpenCode 的本地服務 | 結構化事件、串流 | 依賴 OpenCode 內部協定,版本敏感 | v2.1 評估 |
| C. Plugin(Bus 事件) | 寫 OpenCode plugin 監聽事件 | 深度整合(例如直接餵 log 檔) | 要在 OpenCode 側維護 plugin 程式碼 | 暫不採用 |

> 路徑 A 的實際 CLI flags(如是否支援 `--format json`、`--agent`)以安裝版本的 `opencode run --help` 為準;整合層要包一層「CLI 偵測 + 輸出解析」,把差異隔離在 `src/lib/llm/opencode.ts` 一個檔案內。

### 2.3 金鑰與 .env(已定案:放 .env)

- 工具箱 `.env`(gitignore)放 **provider 金鑰 + OpenCode 設定**,範本寫進 `.env.example`:

```dotenv
# --- OpenCode 整合設定 ---
PST_LLM_ENABLED=true                  # 功能開關(預設 false,見 §16)
PST_OPNCODE_BIN=opencode              # 或絕對路徑
PST_OPNCODE_TIMEOUT_S=120             # 單次分析超時(秒)
PST_OPNCODE_WORKDIR=./data/opencode-workdir   # 沙箱工作目錄(見 §7.6)
PST_OPNCODE_MODEL=                    # 可選:覆寫 opencode 設定的模型

# --- Model provider 金鑰(選一或複數,OpenCode 會自動讀取) ---
# ANTHROPIC_API_KEY=sk-...
# OPENAI_API_KEY=sk-...
# DEEPSEEK_API_KEY=sk-...
# OPENROUTER_API_KEY=sk-or-...
# OLLAMA(本地模型不需要金鑰)
```

- 金鑰**永遠只存在伺服器端**(env 或 OpenCode 的 auth store),不下載到瀏覽器;呼叫走 `POST /api/ai/analyze`(server-side)。

---

## 3. 總體架構:兩段式混合分析

```text
原始 log
  │
  ▼
[確定性層](本地,免費,毫秒,可單元測試)
  parser 抽出結構化事實 ──┬─► 規則引擎匹配 + 證據行
                          └─► Unknown Error 智能 triage(§4.2)
  │
  ▼
規則分析結果(severity / errorTypes / 建議 / 證據 / matchedRuleIds)
  │
  │  用戶按「AI 深度分析」(明確 opt-in)或 unknown-error 自動提示
  ▼
[LLM 增強層](可選,外送前先遮蔽 + 截斷 + 確認)
  prompt = 結構化事實 + 規則結果 + 遮蔽後證據行(±3 行上下文)
  → OpenCode adapter(spawn `opencode run`)→ 解析 JSON → 客戶端驗證
  → 寫入 analysis_cache
  │
  ▼
[合併顯示]
  區塊 A:規則引擎(確定性)— severity badge 以此為準
  區塊 B:AI 推測(假說)— 每條附 confidence + 引用證據行
```

**設計原則(後續每個 phase 都要守住):**

- 規則結果永不因 LLM 而改變;LLM 永遠標記為「推測」;
- 沒有 OpenCode / 未設定金鑰時,所有功能與現在完全一致(向後相容);
- LLM 永不接收整份大 log —— 只接收截斷 + 遮蔽後的片段(§7.2);
- 成本可控:只有用戶明確觸發才外送,結果快取(`analysis_cache`),可設超時與中斷。

---

## 4. Phase 0 — 規則引擎精準化(不動 LLM 先打底)

> 目標:在沒有 LLM 的情況下,把「未知錯誤」的回答也做準。這是性價比最高的階段,也是 LLM 層的地基(prompt 要吃這些結構化事實)。

### 4.1 移除通用噪音

- `GENERIC_INVESTIGATION`(engine.ts:18-24)不再無條件附加;
- 改為:**僅當規則匹配時**,把該規則的 `investigation` 附上;通用檢查項最多保留 2 條並標注 `[generic]`,排在規則建議之後;
- 回歸測試:無匹配的 log 輸出中**不得**出現「Check recent deployment」等模板句。

### 4.2 Unknown Error 智能 triage(核心新增)

新增 `src/lib/rules/triage.ts` — 純函數,輸入是 parser 已抽出的 `ExtractedLogInfo`,輸出結構化的「未知錯誤摘要」,取代現在 3 句死板 fallback:

| 事實 | 推導 |
| --- | --- |
| `exceptions`(如 `NullPointerException`) | 異常類別 → 對應的常見成因+檢查清單(建常見 JVM/JS/Python/.NET 異常映射表) |
| `sources[].file` 副檔名(`.java`/`.py`/`.ts`…) | 語言/框架線索 → 對應的注意事項 |
| `httpStatuses`(4xx vs 5xx) | 4xx → 請求/認證/參數方向;5xx → 服務端/上游方向 |
| `stackTrace === true` | 提示先看第一幀與 `Caused by` |
| `components` | 影響面摘要(「哪個組件先查」) |

### 4.3 擴充規則目錄(10 → ~30 條)

分批加入(每條 = 一個 `RULES` entry + 對應測試):

- **第一批(高頻):** DB 連線池耗盡(`connection pool exhausted`)、SSL/TLS 錯誤、JSON 解析失敗、序列化/反序列化、磁碟滿(`disk full`/`No space left`)、檔案權限、慢查詢(`slow query`)、429 / rate limit、circuit breaker 開啟、Kafka/MQ 錯誤、Redis 錯誤、DNS 解析失敗;
- **第二批(中頻):** 批次任務中斷、訊息重試耗盡、config 載入失敗、記憶體洩漏特徵、證書過期、IPC/序列通訊、WebSocket 斷線、分頁/游標錯誤、字元編碼、時區/夏令時問題;
- **約束:** 每條規則必須有 `detect` 的正/反測試樣本,誤報優先於漏報(寧可不命中,不要亂建議)。

### 4.4 證據與引用(「答案精準」的第一個來源)

- `LogRule` 增加**證據能力**:`evidenceOf(text) → string[]`(回傳命中的原始行),`detect` 保留為快速 boolean;
- UI 顯示 `規則「NullPointerException」命中:第 3、7 行` —— 建議可追溯,工程師可以自己核實;
- `ErrorType` 從封閉 union 擴充(或改為 string literal union 加新成員)。

### 4.5 Severity 校準

- 多條規則同時命中 / 短時間內多行 ERROR(密度偵測)→ 升級一級;
- 保持確定性與可測試性(`engine.test.ts` 擴充)。

**Phase 0 驗收標準:** 拿 20 份真實 production log(含大量 unknown 錯誤),triage 輸出不再有模板句;規則命中率 vs v1 有明顯提升;`npm test` 全綠。

---

## 5. Phase 1 — Log Comparison 去噪

### 5.1 正規化層(`src/lib/log-comparison/normalize.ts`)

對每行做 **token 級遮蔽**後才進 LCS diff(`comparator.ts` 只改輸入,不改核心演算法):

| 型別 | 取代為 |
| --- | --- |
| `2026-08-21T10:15:22.123+08:00` 等時間戳 | `[TS]` |
| UUID、16/32+ hex、`transactionId=ABC123` 等 ID 值 | `[ID]` |
| IP / URL / host:port | `[IP]` / `[URL]` |
| 獨立數字(狀態碼、毫秒數、百分比除外可選保留) | `[N]` |

### 5.2 語意化摘要(取代整行列表)

- 現在只對 **error-like lines**(延伸 `ERROR_LIKE_LINE_RE`)做比較;
- 依「異常類型 + 來源檔案」做 **clustering** → 輸出「新增 3 個 `NullPointerException`(`PaymentService.java:125` 附近)」,而不是 30 行 raw lines;
- 遮蔽後仍然不同的行才進 added/removed 列表(上限 30 條)。

### 5.3 回歸判定校準

- `regression` 判定改以「**新錯誤種類**」為主要訊號(§5.2 的 cluster),而非原始行數;
- 輸出 before/after severity + 逐類對比表(HTTP status、異常類型、組件、訊息)。

**Phase 1 驗收標準:** before/after 僅差時間戳與 ID 的兩份 log → added/removed 為空的黃金樣本測試;`comparator.test.ts` 擴充。

---

## 6. Phase 2 — 匯出 / 備份

- **匯出:** incidents 與 history → JSON(整庫,含 schema 版本)與 CSV(扁平欄位);UI 每個列表頁工具列 + 「設定」頁都放 Export;
- **匯入:** JSON 回載,以 `(tool, created_at, payload hash)` 去重避免重複;
- **可選自動備份:** 每次應用啟動時若 `data/backups/` 不存在,自動寫一份全量 JSON(可關閉);
- 純 lib 實作(`src/lib/database/export.ts`),API route 收尾。

**Phase 2 驗收標準:** 匯出→刪庫→匯入 round-trip 測試(單元 + 手動)。

---

## 7. Phase 3 — OpenCode 整合

### 7.1 整合層(`src/lib/llm/`)

```text
src/lib/llm/
  provider.ts    # 統一 interface: analyze(system, user, opts) → Promise<LlmlResult>
  opencode.ts    # 路徑 A:CLI 子進程 adapter(spawn / timeout / kill / 輸出解析)
  prompts.ts     # prompt 建構(見 §7.3)
  schema.ts      # 輸出 JSON schema + 客戶端驗證(純手寫 validator,不引新依賴)
  redact.ts      # 遮蔽邏輯(重用 detector.ts 的 pattern)
  cache.ts       # analysis_cache 讀寫
```

- `provider.ts` 界定了「換接駁方式不影響上層」:未來若要改走各家 API 直連(路徑 B/直連),只新增一個 adapter;
- **輸出解析策略(路徑 A):** prompt 要求模型只輸出 JSON 區塊(`{ "analysis": {...} }` 包在 markdown fence 內亦可);adapter 用正則抽出 JSON 區塊 → `JSON.parse` → schema 驗證 → 任一環節失敗即報「AI 回應無效」並完整降級到規則結果。實際 flags(`--format json` 等)以 `opencode run --help` 偵測後再決定解析方式,差異全部隔離在本檔案。

### 7.2 隱私守衛(絕不能破壞 local-first 賣點)

1. **只有用戶明確按「AI 深度分析」才外送**;unknown-error 時只顯示提示按鈕,不自動送;
2. 每次外送前,UI 顯示 modal:`將送出 ~N KB 至 {provider/model}` + 遮蔽清單(provider/model 由 `opencode models` / 設定讀取,讀不到就顯示「OpenCode 目前設定」);
3. **自動遮蔽(預設開):** 重用 `detector.ts` 的 pattern,把 password/token/authorization/bearer… 的**值**換成 `[REDACTED:key]`;用戶可切「原樣傳送」,但需再次確認;
4. **截斷:** 只送「開頭 10 行 + 結尾 20 行 + 規則命中行 ± 3 行」,總量上限 ~4K tokens,超出即丟棄中間;
5. 設定頁常駐隱私摘要(provider、遮蔽模式、快取狀態);
6. **可選審計表** `llm_calls`(本地記錄:時間、tool、provider、送出 bytes、遮蔽與否)—— 預設關閉,政企環境建議開。

### 7.3 Prompt 設計(精準度的關鍵)

- **輸入不是 raw log**,而是:`ExtractedLogInfo`(JSON)+ 規則命中結果(`matchedRuleIds` + 理由)+ 遮蔽後證據行;
- System prompt 要點:
  - 角色:資深 production support 工程師;
  - **只依據提供的 facts 作答**,不得編造行號/檔案;
  - 證據不足時明確寫 `unknown`,`confidence` 低;
  - **只輸出 JSON**,不輸出其他文字(agent 模式下的 final message 即為 JSON);
- `temperature = 0`(OpenCode 設定或 per-run override);
- 輸出 schema:

```jsonc
{
  "severity": "High",                 // 僅供參考,不覆寫規則結果
  "errorTypes": ["NullPointerException"],
  "rootCause": "簡短 1-3 句",
  "evidenceLines": [5, 7],            // 必須引用輸入行的行號
  "nextSteps": ["步驟 1", ...],        // 最多 5 條
  "confidence": 0.7,                  // 0-1
  "explanation": "推導過程,含引用的 facts"
}
```

- 客戶端驗證失敗、CLI 錯誤或超時 → 顯示「AI 回應無效/不可用」+ 規則結果照常顯示(完整降級)。

### 7.4 合併顯示與衝突處理

- 結果頁分兩區:**「規則引擎(確定性)」** 與 **「AI 推測(未驗證)」**;
- AI 每條主張附 `confidence` + 引用的證據行(可點擊跳回原文);
- LLM 的 severity 與規則衝突時:**以規則為準**,並列顯示差異(不讓模型覆寫 badge);
- Log Analyzer 的 AI 結果可像規則結果一樣存進 Support History(payload 已含 AI 區塊)。

### 7.5 Cache 與成本

- `analysis_cache` 表:`cache_key = sha256(tool + normalized input + model + prompt 版本)` → 命中直接回,零成本;
- `max_tokens` 由 OpenCode 側設定為準;工具箱側以超時控制成本上限;
- 快取保留 30 天、上限 10,000 筆,超出刪最舊(啟動時清理)。

### 7.6 執行安全(OpenCode 是 agent,這是新增風險)

1. **沙箱工作目錄:** spawn 時 `cwd` 固定在 `data/opencode-workdir/`(啟動時自動建立),不放任何真實資料;
2. **prompt 硬性限制:** 明確要求「只分析、不要執行任何命令、不要讀寫檔案」;若 `opencode run` 支援限制工具的選項(以 `--help` 為準),一律開啟;
3. **超時與殺進程:** `PST_OPNCODE_TIMEOUT_S`(預設 120s)到點 `SIGKILL` 子進程,UI 顯示可中斷;
4. **輸出大小上限:** adapter 截斷 stdout 至 64KB 再解析,防止失控輸出;
5. **(可選強化)低權限執行:** 以專用使用者/容器跑 opencode 子進程(部署版再做);
6. 以上全部寫進風險表(§14)與測試計劃(§13)。

### 7.7 範圍(先深後廣)

- **先做 Log Analyzer 的「AI 深度分析」**;存好 provider/prompt/cache 基礎設施後;
- 第二批:Log Comparison 的「AI 摘要差異」、SQL Toolbox 的「AI 解釋這段 SQL」、Cron 的「AI 描述複雜規則」;
- 每個新工具 = 一個 prompt 模板 + schema,零架構變更。

---

## 8. 檔案結構變更總覽

```text
新增:
  src/lib/llm/{provider,opencode,prompts,schema,redact,cache}.ts
  src/lib/rules/triage.ts
  src/lib/log-comparison/normalize.ts
  src/lib/database/{settings,export}.ts
  src/app/api/ai/analyze/route.ts
  src/app/settings/page.tsx              # 設定頁(server component 讀 settings)
  src/features/settings/SettingsPage.tsx
  src/features/log-analyzer/AiPanel.tsx  # AI 結果區 + 隱私 modal
  .env.example                           # PST_* 與 provider 金鑰範本(§2.3)
變更:
  src/types/index.ts                 # ErrorType 擴充、LogRule.evidenceOf、LlmlResult 等
  src/lib/rules/engine.ts            # 去 GENERIC 噪音、整合 triage(§4.1-4.2)
  src/lib/rules/rules.ts             # 擴充 ~20 條新規則 + evidence
  src/lib/log-comparison/comparator.ts  # 改用 normalize 後輸入、cluster 輸出
  src/lib/database/db.ts             # migrate 新增 settings / analysis_cache / (llm_calls)
  src/features/log-analyzer/LogAnalyzer.tsx  # AI 按鈕 + AiPanel
  src/features/log-comparison/LogComparison.tsx # 新輸出格式
  README.md(隱私模型章節 + OpenCode 安裝/設定說明)
```

---

## 9. DB schema 變更(`db.ts` migrate 追加,維持 `CREATE TABLE IF NOT EXISTS` 向後相容)

```sql
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_cache (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key  TEXT NOT NULL UNIQUE,
  tool       TEXT NOT NULL,
  model      TEXT NOT NULL DEFAULT '',
  result     TEXT NOT NULL,          -- LlmlResult JSON
  created_at TEXT NOT NULL
);

-- 可選(預設關閉)審計表
CREATE TABLE IF NOT EXISTS llm_calls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT NOT NULL,
  tool        TEXT NOT NULL,
  provider    TEXT NOT NULL,
  bytes_sent  INTEGER NOT NULL,
  redacted    INTEGER NOT NULL DEFAULT 1,
  ok          INTEGER NOT NULL DEFAULT 1
);
```

---

## 10. 非功能需求與驗收標準(發版 Gate)

| 項目 | 要求 | 驗收方式 |
| --- | --- | --- |
| 確定性層延遲 | 單次規則分析 < 1s(本地) | 基準測試樣本 |
| LLM 層延遲 | P95 ≤ 120s(可被超時/中斷) | 手動 + 計時 |
| 離線可用 | 無 OpenCode/金鑰時,v1 功能 100% 可用 | 移除 .env 跑全測試 |
| 隱私 | 每次外送都有 opt-in + 預估 bytes + 遮蔽清單 | UI 驗收 + 測試 |
| 向後相容 | 既有 incidents/history 資料與 API 不變 | 既有測試 + 手動 |
| 快取 | 相同輸入+模型 → 第二次零外送 | 單元測試(已 mock) |
| 品質閘 | `npm test` / `lint` / `typecheck` 全綠 | CI 或本地 |
| 文件 | README 隱私章節 + OpenCode 安裝步驟更新 | 人工檢視 |

---

## 11. 成本估算(僅供參考,實際以模型定價為準)

每次「AI 深度分析」約送出 2–4K tokens、回應 < 1K tokens(有截斷與 schema 限制):

| 模型族群 | 粗估每次成本(約數) | 備註 |
| --- | --- | --- |
| DeepSeek 系列 | < NT$0.01 | 便宜,中文佳 |
| GPT-4o / Claude 系列 | NT$0.05–0.2 | 依型號 |
| 本地 Ollama(如 Qwen) | 0(電力) | 隱私最佳 |
| OpenRouter 聚合 | 視模型而定 | 彈性大 |

成本控制組合:僅用戶觸發 + cache + 超時上限 + 可選每 tool 頻率限制。此表不作為發版 Gate,僅供決策參考。

---

## 12. UI/UX 概要

1. **Log Analyzer:** 結果區上方新增「AI 深度分析」按鈕(僅在規則結果就緒後可點);點擊 → 隱私 modal(送出大小 / provider / 遮蔽清單 / 兩顆鍵:「以遮蔽模式傳送」「取消」)→ 分析中狀態(可中斷)→ AI 區塊與規則區塊並列;
2. **AI 區塊:** severity(參考)、rootCause、nextSteps、confidence 橫條、證據行引用(點擊跳回輸入框對應行);
3. **設定頁(新):** OpenCode 狀態(二進位路徑、版本、可選模型清單)、PST_* 設定摘要、遮蔽策略開關、審計開關、「清除快取」與「立即匯出備份」;
4. 全部遵循現有「Input → Action → Result → Copy → Clear」模式與暗色主題。

---

## 13. 測試計劃

| Phase | 測試內容 |
| --- | --- |
| 0 | 每條新規則正/反用例;triage 以 parser 輸出為輸入的單元測試;**「無匹配時不得出現模板句」回歸測試**;證據行正確性 |
| 1 | normalize 遮蔽測試(時間戳/ID/數字/IP/URL);「僅時間戳與 ID 不同」的兩份 log → diff 為空的黃金樣本 |
| 2 | 匯出→匯入 round-trip(單元 + 手動);去重行為 |
| 3 | opencode.ts 以**假 CLI 腳本**(stub 二進位回傳固定 JSON / 亂碼 / 超時)測試:成功、解析失敗、超時殺進程、stdout 上限;schema 驗證失敗路徑;redact 端到端;cache 命中/失效;降級路徑;隱私 modal 內容正確;`spawn` 參數(cwd 沙箱、env 不含多餘變數) |
| 全體 | `npm test` / `npm run lint` / `npm run typecheck` 全綠;手動:接真實 OpenCode(建議先以本地 Ollama 或便宜模型)做一次驗收,需本機安裝 opencode |

---

## 14. 風險與對策

| 風險 | 對策 |
| --- | --- |
| LLM 幻覺(編造行號/根因) | grounding(只餵 facts)+ schema 約束 + 強制 evidence 引用 + confidence + 「AI 推測」標記,severity 以規則為準 |
| 私隱洩漏 | opt-in 才外送 + 自動遮蔽 + 截斷 + 預估 bytes 顯示 + key 只存 server 端 + 可選審計表 |
| **OpenCode 是 agent,可能執行命令/改檔(新增)** | 沙箱 cwd + prompt 硬性限制 + 超時 SIGKILL + stdout 上限 +(可選)低權限執行;實作時確認工具限制選項 |
| 成本失控 | 僅用戶觸發 + cache + 超時上限 + 頻率限制 |
| CLI 版本差異(flags/輸出格式) | 差異隔離在 `opencode.ts`;`--help` 偵測;stub 測試涵蓋 |
| LLM 層延遲高(agent loop) | 明確 UX(載入/中斷)+ 超時 + cache;建議在 opencode 設定輕快模型做分析 |
| OpenCode 不可用/未安裝 | 完整降級至規則引擎,錯誤訊息明確,離線體驗不變 |
| 規則誤報 | 誤報優先於漏報原則 + 每條規則正/反測試;UI 可收起規則建議 |
| DB migration 風險 | 全用 `CREATE TABLE IF NOT EXISTS`,不動既有表;回滾見 §16 |
| 決定點未定(§17) | 全部提供預設值,先跑通用方案 |

---

## 15. 里程碑與工時估算

| 里程碑 | 內容 | 估算(單人兼職) |
| --- | --- | --- |
| **M0** | Phase 0:去噪 + triage + 擴規則 + 證據 | 3–5 天 |
| **M1** | Phase 1:comparison 正規化 + cluster | 2–3 天 |
| **M2** | Phase 2:匯出 / 備份 | 1–2 天 |
| **M3** | Phase 3:OpenCode 整合(adapter + 隱私 + prompt + cache + UI + 設定頁 + 安全措施) | 6–9 天 |
| **M4** | README/隱私模型更新、OpenCode 安裝指引、驗收、發版 v2.0 | 1–2 天 |

- **發版策略:** M2 完成即可發 **v1.1**(純確定性改良,無新外部依賴);M3 完成發 **v2.0**(OpenCode 增強)。
- 兼任開發:總計約 **4–7 週**;全職:約 **2.5–3.5 週**。

---

## 16. 回滾與功能開關

- **功能開關:** `PST_LLM_ENABLED`(預設 `false`)→ 即使代碼已上線,未開關/未設金鑰時行為等同 v1;
- **DB 回滾:** 所有 migrate 均為 additive(`CREATE TABLE IF NOT EXISTS`),回滾舊版不會壞,新表殘留無害;
- **代碼回滾:** 按里程碑打 tag(v1.1 / v2.0-rc),出問題 `git revert` 即可;
- **降級路徑:** LLM 任何失敗(CLI 錯誤/超時/格式無效/金鑰缺失)→ 自動回到規則結果,不阻塞用戶。

---

## 17. 開放決定事項(已定案項目標 ✔)

| # | 事項 | 狀態 / 建議 |
| --- | --- | --- |
| 1 | 接駁方式 | ✔ 定案:OpenCode 優先(路徑 A:CLI 子進程) |
| 2 | 金鑰存放 | ✔ 定案:`.env`(provider 金鑰由 OpenCode 讀取) |
| 3 | 實際模型選擇(Anthropic / OpenAI / DeepSeek / Ollama?) | **待定** — 建議先用本地 Ollama 驗收流程,再訂貴模型 |
| 4 | 遮蔽策略:預設自動遮蔽 vs 只警告 | 建議預設自動遮蔽(可切換) |
| 5 | 審計表 `llm_calls` | 預設關閉,政企環境建議開 |
| 6 | v2.0 範圍:僅 Log Analyzer 的 AI | 建議先做 Analyzer,其餘 v2.1 |
| 7 | 低權限執行(沙箱使用者) | 部署版再做 |

---

## 18. 一句話總結

> 先讓確定性層(規則)變誠實、可追溯(Phase 0–1),再以「grounding + schema + 遮蔽 + 快取 + 沙箱」五個守衛,透過 OpenCode 接上模型(Phase 3)—— 這樣 AI 加持之後的答案**才真的更精準**,而 local-first 的隱私賣點與離線可用性絲毫不損。