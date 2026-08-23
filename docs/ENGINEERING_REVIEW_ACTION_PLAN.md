# Production Support Toolbox 工程改善計畫

> Review 日期：2026-08-23  
> 目標讀者：後續負責實作的 Engineering Agents  
> 目前定位：適合 localhost 個人／小團隊使用的 internal MVP；尚不建議直接暴露於 LAN 或 Internet。

## 1. 現況結論

專案整體結構清楚，`src/lib` 與 React UI 分離，TypeScript、ESLint、production build 及現有單元測試均通過。SQLite queries 普遍使用 prepared statements，LLM fallback 亦具備 opt-in、timeout、redaction、schema validation 與 cache 等基本防護。

本次驗證結果：

- `npm.cmd test`：23 個 test files、236 個 tests 全數通過。
- `npm.cmd run typecheck`：通過。
- `npm.cmd run lint`：通過。
- `npm.cmd run build`：Next.js production build 成功。
- Vitest 顯示 config loader 的未來相容性警告，目前不影響執行。

主要差距集中於 deployment boundary、API access control、custom regex、備份完整性、批次匯入 atomicity、CSV 安全性，以及 production observability。

## 2. 執行原則

- 優先完成 P0，再處理 P1；P0 未完成前，不應將服務暴露到 localhost 以外。
- 每項修改必須補測試，且不得破壞既有 API contract，除非文件明確記錄 migration。
- 所有 public functions 應保留或補上 JSDoc。
- 不得把 API key、log 原文、Authorization header、PII 或完整 SQLite error 寫入 client response／application log。
- 新增 dependency 前，需記錄用途、維護狀態、授權與 vulnerability audit 結果。
- 完成每個工作項目後執行：`npm.cmd test`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run build`。

## 3. P0：建立明確的部署與存取控制邊界

### 問題

目前 incidents、history、import/export、custom rules 等 API 沒有 authentication 或 authorization。只要服務可由其他主機連線，未授權使用者即可讀取、修改、匯出或刪除 production-support 資料。

涉及位置：

- `src/app/api/incidents/**`
- `src/app/api/history/**`
- `src/app/api/import/route.ts`
- `src/app/api/export/route.ts`
- `src/app/api/tools/rules/**`
- `next.config.ts`
- `package.json`
- `README.md`

### 實作工作

- 預設啟動命令明確綁定 `127.0.0.1`，避免隱含依賴 framework 預設值。
- README 加入醒目的 deployment warning：未啟用 access control 前不得直接暴露於 LAN／Internet。
- 建立集中式 API security middleware／helper，避免每個 route 自行實作。
- 若需 remote/team mode，至少提供：
  - 從環境變數載入的高熵 API token，使用 constant-time comparison。
  - `Authorization: Bearer` 驗證；禁止 query-string token。
  - read、write、admin scope；import/export、rule mutation、delete 應屬高權限操作。
  - write routes 的 Origin／CSRF 防護。
  - token 不得出現在 response、log、history 或 export。
- 未配置 remote access 時維持 local-only，並 fail closed。
- 若未來正式多人部署，優先改用 reverse proxy + OIDC，而不是持續擴充自製 identity system。

### 驗收條件

- 預設啟動只能由 loopback 存取。
- Remote mode 未提供 credential 時拒絕啟動或拒絕所有受保護 API。
- 無 token、錯誤 token、錯誤 scope 分別得到穩定的 `401`／`403`。
- 所有 mutation、import/export、incident/history read routes 均有 access-control tests。
- API response 與 server log 不洩漏 token。

## 4. P1：消除 Custom Regex ReDoS

### 問題

`src/lib/rules/custom.ts` 只以 `new RegExp(pattern)` 驗證語法；合法 regex 仍可能包含 catastrophic backtracking。`src/lib/rules/engine.ts` 會在多條規則與多行大型 log 上反覆執行 pattern，可能阻塞 Node.js event loop。

目前最壞路徑概念上為：

```text
rules × patterns × log lines × regex evaluation cost
```

### 實作工作

- 優先評估 RE2-compatible engine，避免 backtracking regex。
- 若不能使用 RE2：
  - 在註冊及匯入時拒絕 nested quantifiers、ambiguous alternation 等高風險 regex。
  - 分析工作移至 Worker thread／隔離程序並設 hard timeout。
  - 保留現有 pattern、rule、log size caps，並按 benchmark 再收緊。
- Pattern runtime failure 不得令整個 request crash；response 應指出跳過的 rule，但不要洩漏內部 stack trace。
- 文件清楚說明支援的 regex subset。

### 驗收條件

- `(a+)+$` 等已知惡意 pattern 會在註冊階段被拒絕，或在硬性時間上限內中止。
- 新增 adversarial regex、最大 log、最大 rules 的 performance tests。
- 單一惡意 rule 不會長時間阻塞其他 API requests。
- 正常既有 custom rules 保持相容，或提供明確 migration 說明。

## 5. P1：Custom Rules 匯入必須真正 atomic

### 問題

`src/app/api/tools/rules/import/route.ts` 宣稱 all-or-nothing，但目前只先 validate，之後逐筆呼叫 `createCustomRule()`。若中途遇到 active-rule cap、SQLite 錯誤或程序異常，先前資料已經寫入。

### 實作工作

- 將 validation、duplicate calculation、capacity check 和 inserts 放在單一 SQLite transaction。
- 在寫入前一次計算：現有 active count + 本次新增 active count。
- Repository 提供 bulk-import function；route 只負責 parsing 和 response mapping。
- Transaction 中不要重複取得不同 database connection／singleton state。
- 保留 duplicate skip 行為，並讓結果計數可預測。

### 驗收條件

- 模擬第 N 筆 insert failure 後，資料庫完全沒有本批次的 partial writes。
- 超過 active cap 時整批拒絕，既有資料不變。
- duplicate、inactive rules、空 bundle、invalid entry 均有測試。
- API 文件中的 all-or-nothing 敘述與實際行為一致。

## 6. P1：備份與還原涵蓋 Custom Rules

### 問題

SQLite schema 包含 `incidents`、`history`、`analysis_cache`、`custom_rules`，但 daily backup 與主要 JSON export 只涵蓋 incidents/history。`analysis_cache` 可重建，但 `custom_rules` 是使用者正式設定，不應遺失。

涉及位置：

- `src/lib/database/backup.ts`
- `src/lib/database/export.ts`
- `src/app/api/export/route.ts`
- `src/app/api/import/route.ts`
- Settings UI

### 實作工作

- 將 `customRules` 加入 backup bundle。
- Backup schema version 升級，新增 backward-compatible importer。
- 明確決定 `analysis_cache`：建議不備份，並在 schema／文件標註為 disposable cache。
- Daily backup 和手動 export 使用相同 canonical serializer，避免格式漂移。
- 建立 restore verification：export → clean temporary DB → import → deep comparison。
- 寫檔採 atomic replace：同目錄 temporary file、flush／close、rename，避免程序中斷留下半份 JSON。
- 設計 retention policy，避免每日備份無限成長。

### 驗收條件

- 搬移到全新 DB 後，incidents、history、custom rules 均可完整恢復。
- 舊 schema v1 backup 仍可匯入。
- 中斷備份寫入不會覆蓋最後一份有效備份。
- Backup／restore integration tests 通過。

## 7. P1：防止 CSV Formula Injection

### 問題

`src/lib/database/export.ts` 的 `csvEscape()` 只處理雙引號。以 `=`, `+`, `-`, `@` 開頭的使用者內容，可能在 Excel／LibreOffice 中被當作公式執行。前置 whitespace、tab 或控制字元也可能繞過簡單判斷。

### 實作工作

- 建立 spreadsheet-safe cell sanitizer，再執行 CSV quote escaping。
- 對不可信文字欄位處理公式前綴及其常見 whitespace/control-character bypass。
- 數值與受控 enum 欄位維持原本型別語意，不要盲目將所有 cell 變成文字。
- README／export UI 記錄 CSV 是 spreadsheet-safe output。

### 驗收條件

- `=HYPERLINK(...)`、`+cmd...`、`-1+1`、`@SUM(...)`、tab/CR/LF 前綴案例不會被 spreadsheet 當公式。
- Quotes、commas、Unicode、multiline fields 仍能正確 round-trip。
- Incidents 與 history CSV 均有 regression tests。

## 8. P2：修正 active rule capacity 更新錯誤

### 問題

`src/lib/database/customRules.ts` 的 `updateCustomRule()` 對所有 active 結果執行 `assertUnderCap(true)`。當 active rules 剛好達上限時，修改既有 active rule 的名稱或內容也會被拒絕。

### 實作工作

- 只有 `inactive → active` transition 才檢查是否增加 active count。
- `active → active`、`active → inactive`、`inactive → inactive` 不應錯誤觸發 cap。
- Capacity check 與 update 放在同一 transaction，避免 concurrent race。

### 驗收條件

- 在 cap 已滿時，既有 active rule 仍可更新內容。
- 在 cap 已滿時，inactive rule 不可被啟用。
- 停用一條 rule 後，可啟用另一條 rule。
- 四種 state transition 均有 repository tests。

## 9. P2：標準化 Error Handling 與 Observability

### 問題

多個 API route 直接把任意 `Error.message` 回傳 client，可能洩漏 SQLite path、內部 implementation 或 upstream response。各 route 亦重複 error mapping。

### 實作工作

- 建立統一 error taxonomy，例如：
  - `VALIDATION_ERROR` → 400
  - `UNAUTHENTICATED` → 401
  - `FORBIDDEN` → 403
  - `NOT_FOUND` → 404
  - `CONFLICT` → 409
  - `RATE_LIMITED` → 429
  - `INTERNAL_ERROR` → 500
- Client response 僅包含穩定 error code、safe message、request ID。
- Server-side structured logs 記錄 request ID、route、duration、status、error class；不得記錄完整 log、payload、PII、credential。
- OpenRouter error response 不要直接轉送 response body；只保留必要的 status/category。
- 為分析、import/export、backup、AI fallback 加入 latency／success／failure metrics hooks。

### 驗收條件

- 非預期 SQLite／filesystem／upstream exception 對 client 一律是 sanitized `500`。
- Validation error 仍提供可操作但不洩漏內部資訊的訊息。
- 每個 request 可透過 request ID 在 server log 關聯。
- Secret-redaction tests 覆蓋 error 與 logging paths。

## 10. P2：補齊 Production Reliability Tests

### 建議新增測試層級

1. API integration tests
   - Authentication、authorization、status codes、body limits。
   - CRUD、import/export、rule lifecycle。
2. Database tests
   - Transaction rollback、WAL concurrent access、restart、migration。
   - Backup corruption、atomic write、restore drill。
3. Security regression tests
   - ReDoS、CSV injection、secret leakage、unauthorized export/delete。
4. Performance tests
   - 最大 log × 最大 custom rules。
   - Large history search、export memory consumption。
5. Browser E2E
   - Analyze → save → history reopen。
   - Incident CRUD。
   - Export → import。
   - AI fallback disabled、success、timeout、invalid response。

### 驗收條件

- CI 依序執行 unit、integration、typecheck、lint、build。
- Performance tests 設定可量測的 latency／memory budgets，不只確認「沒有 exception」。
- 至少有一個完整 backup restore drill。
- 關鍵 mutation API 有 unauthorized 與 rollback 測試。

## 11. P3：工程品質改善

### Vitest config 相容性

目前測試顯示 Vite native config loader 的未來相容性警告。可選方案：

- 將 package 明確設為 ESM，確認 Next.js、Vitest 與 scripts 全部相容；或
- 將 Vitest config 改為相符的 module extension/config 格式。

驗收：`npm.cmd test` 不再顯示該警告。

### API body limits

除了 log analyzer 已有字元上限外，應為 import、rules import、JSON、comparison、history payload 等 endpoint 建立一致的 request-size policy，並在 JSON parse 前由 server/proxy 層限制 bytes。

### Search scalability

目前 history 以多欄位 `%LIKE%` 搜尋，資料量大時會全表掃描。Local small-data 情境可接受；若轉為團隊服務，應評估 SQLite FTS5、pagination 與 result limits。

## 12. 建議工作拆分

可交由不同 Agent 分支處理，但避免同時修改同一核心檔案：

| Workstream | 優先級 | 主要範圍 | 建議依賴 |
| --- | --- | --- | --- |
| Local binding + API auth | P0 | middleware、routes、README、tests | 無 |
| Regex safety | P1 | rules validation、engine、benchmarks | API auth 可平行 |
| Atomic rules import + cap bug | P1/P2 | customRules repository、rules import | 建議同一 Agent |
| Backup schema v2 + restore | P1 | backup/export/import、Settings | 先定 schema |
| CSV injection | P1 | export helper、tests | 可獨立 |
| Error handling + observability | P2 | shared errors、全部 routes | Auth contract 確定後 |
| Integration/E2E/performance | P2 | test infrastructure、CI | 跟隨上述功能 |

## 13. Agent 完工回報模板

每個 Agent 完成工作時，請提供：

```markdown
## 完成項目
- 對應章節／issue：
- 行為變更：
- API 或資料格式變更：

## Security Audit
- Input validation：
- Authentication／authorization：
- Sensitive data handling：
- DoS／resource limits：

## Verification
- Tests added：
- npm.cmd test：
- npm.cmd run typecheck：
- npm.cmd run lint：
- npm.cmd run build：

## Remaining Risks
- 尚未處理事項：
- Migration／deployment 注意事項：
```

## 14. 執行記錄（Implementation Log）

> 由 Engineering Agent 於 2026-08-23 按實作完成後補記，供後續 review 追蹤每項對應章節、行為變更與驗證。

### 已完成

| 章節 | 狀態 | 主要變更 | 驗證 |
| --- | --- | --- | --- |
| §3 P0 Local binding + API auth | ✅ | `package.json` 預設 `-H 127.0.0.1`（`dev`/`start`）；新增 `dev:remote`/`start:remote` + `scripts/check-remote.mjs`（無 credential 拒絕啟動，fail closed）；`src/lib/api/auth.ts` 集中式 Bearer token 驗證（constant-time SHA-256 compare、read/write/admin scope、CSRF Origin 檢查、query-string token 禁止）；全部 data routes 接上；GUI `apiFetch` 自動附 token（Settings 可存 localStorage） | 336 tests；auth matrix + CSRF + fail-closed 測試 |
| §4 P1 ReDoS | ✅ | 三層驗證：語法 → 靜態 screening（`src/lib/rules/regexSafety.ts`：nested quantifier、quantified-alternation 共用首字、backreference）→ worker 內時間上限 torture（`src/lib/rules/torture.ts`，ready-gated budget）；engine 對 runtime pattern failure 跳過並回報 `skippedRules`；文檔列出支援 subset | `(a+)+$` 等註冊即拒；adversarial/perf tests；現有 custom rules 相容 |
| §5 P1 Atomic rules import | ✅ | `bulkImportCustomRules`／`importCustomRulesInTransaction`：validation + duplicate + capacity + inserts 同一 transaction（IMMEDIATE）；route 只做 parsing/response mapping | 第 N 筆 insert 失敗 → 零 partial writes；cap 超限整批拒絕；testing |
| §6 P1 Backup v2 | ✅ | `BACKUP_SCHEMA_VERSION=2`；`customRules` 入 bundle；canonical serializer（`src/lib/database/snapshot.ts`）統一 daily backup 同手動 export；atomic write（temp+fsync+rename）；retention（`PST_BACKUP_RETENTION` 預設 30）；importer 相容 v1；`analysis_cache` 標記為 disposable cache 不備份 | export→clean DB→import 深度比較 round-trip；v1 legacy 可匯入；drift 測試 |
| §7 P1 CSV injection | ✅ | `csvSafeCell`：`= + - @`（忽略前置 whitespace/control chars）加 `'` prefix；數值/enum 保持語意；README 記錄 spreadsheet-safe | `=HYPERLINK`、`+cmd`、`-1+1`、`@SUM`、tab/CR/LF bypass 全部 neutralized；quotes/commas/Unicode/multiline round-trip 不變 |
| §8 P2 Cap transition bug | ✅ | 只有 `inactive→active` 先檢查 cap；cap 檢查 + update 同一 transaction | 四種 transition 都有 repository 測試 |
| §9 P2 Error handling + observability | ✅ | `ApiError` taxonomy（VALIDATION_ERROR…INTERNAL_ERROR + PAYLOAD_TOO_LARGE/SERVICE_UNAVAILABLE）；`sanitizeError` 保證未知 error 一律 sanitized 500；`withApi` 統一 requestId/duration/logging；`logger.ts` structured JSON logs；`metrics.ts` latency/success/failure hooks（analysis/export/import/backup/ai_fallback/rules_import）；OpenRouter 錯誤只傳 status/category，唔轉送 body | secret-redaction tests（EACCES/SQLite path 唔會洩漏）；request ID 關聯測試 |
| §10 P2 Reliability tests | ✅ | API integration tests（auth matrix、CRUD、export/import、rules lifecycle、cap reject、ReDoS via API、analyze fallback-disabled）；database（backup/restore drill、atomicity、rollback）；security regression（CSV injection、secret leakage、unauthorized export/delete）；performance budgets（large log × 100 custom rules）；engine runtime-skip | 全綠 |
| §11 P3 Vitest config | ✅ | `vitest.config.ts` → `vitest.config.mts`（explicit ESM） | `npm test` 不再顯示 native-loader 警告 |
| §11 P3 Body limits | ✅ | `guardBodySize`（Content-Length pre-parse cap，2MB 預設）；rules import ≤500 entries；import data ≤2M chars | 測試 |
| §11 P3 Search scalability | 📝 已文件化 | history 多欄 `%LIKE%` 全表掃描：local small-data 可接受；團隊規模建議 FTS5 + pagination（已寫入本節建議，未實作） | — |
| 後續：AI 分析提速（streaming） | ✅ | 用戶回報「AI 分析 LOAD 好耐」（實測一次 0-match 分析 71s）：(1) `FALLBACK_MAX_TOKENS` 4096→1600；(2) `buildFallbackContext` 每行 cap 300 chars；(3) 新增 `streamFallback`（AsyncGenerator，OpenRouter `stream:true`，SSE `delta`/`result`/`error` 事件，cache/繁中/schema 保證同 runFallback 一致）＋ `POST /api/tools/analyze/stream` route（GUI 專用，規則命中不會誤觸）＋ GUI `triggerAiFallback` 改為 SSE reader 並顯示即時 delta 預覽；agent-facing `/api/tools/analyze` 不變 | 348/348 tests（streamFallback 單元 + SSE route 整合：delta 順序、cache hit 零 fetch、簡體轉繁中、429 唔洩 body、rules-matched 唔 call AI）；live smoke：delta 12s 內逐段流出 |

### 仍屬風險（Remaining Risks）

- Regex torture 係「實測證明」而唔係形式化證明：理論上仍有可能存在 static 冇捉到、torture inputs 又測試唔到嘅 pathological pattern。目前靠 pattern length cap（300）/ rule 上限（200）+ worker 隔離兜底；如要更強保證需換 RE2-compatible engine。
- Remote token 模型係單一 shared secret 組合，未做 per-user identity；多人正式部署請改用 reverse proxy + OIDC（§3 建議不變）。
- token 存於 browser localStorage（GUI 自動附頭）— XSS 可由 localStorage 偷 token；本 app 無外部 script，風險可控，但 strict CSP 屬 future work。
- `analysis_cache` 會無限增長（disposable cache，冇 retention）——低優先 backlog。

### 驗證（完工時）

- `npm test`：**348/348**（31 個 test files）
- `npm run typecheck`：通過
- `npm run lint`：0 errors 0 warnings
- `npm run build`：通過（20 routes）

## 15. Definition of Done

本改善計畫可在以下條件成立時視為完成：

- 預設服務只接受 loopback；remote mode 有 authentication、authorization 與安全文件。
- Custom regex 無法無限期阻塞 event loop。
- Rules import 真正 atomic，active cap 更新邏輯正確。
- Backup schema 可完整保存並還原 custom rules。
- CSV export 通過 formula-injection regression tests。
- Client 不會收到未清理的 internal errors。
- 關鍵 API 具備 integration、security、rollback 與 performance tests。
- 全部 unit tests、typecheck、lint、production build 通過。

