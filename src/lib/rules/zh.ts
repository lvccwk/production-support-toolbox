/**
 * Traditional Chinese (zh-Hant) texts for the deterministic rule engine.
 *
 * Keyed by rule id — the engine merges these with the English catalogue so
 * every analysis has both languages. Content intentionally mirrors rules.ts
 * one-to-one; missing entries fall back to the English text.
 */

import type { Severity } from "@/types";

export interface RuleZh {
  rootCausesZh: string[];
  investigationZh: string[];
  suggestedFixesZh: string[];
  longTermImprovementsZh: string[];
}

export const SEVERITY_ZH: Record<Severity, string> = {
  Critical: "嚴重",
  High: "高",
  Medium: "中",
  Low: "低",
  Informational: "資訊",
};

export const RULE_ZH: Record<string, RuleZh> = {
  "null-pointer": {
    rootCausesZh: [
      "程式解除了 null 物件的引用。",
      "資料庫查詢可能沒有回傳任何記錄。",
      "缺少請求或輸入的驗證。",
      "預期的設定或環境變數可能不存在。",
    ],
    investigationZh: [
      "從堆疊追蹤找出確切的類別與行號。",
      "檢查輸入資料是否為 null 或空值。",
      "檢查資料庫查詢是否沒有回傳記錄。",
      "檢查呼叫路徑上的請求/輸入驗證。",
      "檢查失敗前一刻的相關日誌。",
    ],
    suggestedFixesZh: [
      "在處理付款記錄或請求前加入 null 驗證。",
      "取用數值時使用 Optional / 安全存取。",
      "與其解引用 null，不如回傳明確錯誤。",
    ],
    longTermImprovementsZh: [
      "加入防禦性驗證並隔離異常批次記錄，避免單一失敗記錄中止整個批次。",
      "記錄已淨化的輸入，讓 null 的來源可追蹤。",
    ],
  },
  "sql-error": {
    rootCausesZh: [
      "資料庫暫時不可用。",
      "鎖衝突或死結（deadlock）。",
      "查詢逾時。",
      "SQL 語法不正確。",
      "缺少資料表或欄位。",
    ],
    investigationZh: [
      "檢查資料庫是否可用與連線池狀態。",
      "檢查鎖定：尋找死結或鎖逾時報告。",
      "檢查長時間查詢的逾時門檻。",
      "檢視失敗的 SQL 語句與物件名稱。",
      "檢查 DB2/SQL 錯誤碼與訊息細節。",
    ],
    suggestedFixesZh: [
      "確認資料庫可用後重試該操作。",
      "簡化查詢或加索引以減少鎖定時間。",
      "對照 schema 確認資料表與欄位名稱。",
      "視情況調高語句逾時。",
    ],
    longTermImprovementsZh: [
      "為短暫的資料庫錯誤加入退避重試機制。",
      "將重度分析查詢導向報表副本。",
      "在 WHERE 與 JOIN 使用的欄位加索引。",
    ],
  },
  timeout: {
    rootCausesZh: [
      "網路或 DNS 解析緩慢。",
      "下游 API 依賴未在時限內回應。",
      "資料庫查詢緩慢或被鎖住。",
      "執行緒池或連線池被耗盡。",
    ],
    investigationZh: [
      "檢查元件間的網路延遲與連線狀況。",
      "檢查下游 API 及其上游依賴。",
      "檢查長時間執行的資料庫查詢。",
      "檢查執行緒池與連線池的使用率。",
      "檢查近期部署或流量尖峰。",
    ],
    suggestedFixesZh: [
      "在安全前提下調高逾時或加入退避重試。",
      "修復緩慢的依賴或查詢。",
      "及時釋放連線以騰出池容量。",
    ],
    longTermImprovementsZh: [
      "在外部呼叫加入熔斷器與艙壁隔離。",
      "設定 SLO 並對逾時率發出告警。",
    ],
  },
  "connection-failure": {
    rootCausesZh: [
      "資料庫或服務已停機或無法到達。",
      "網路或防火牆阻擋連線。",
      "主機、埠或端點設定錯誤。",
      "連線池內的所有連線已被使用。",
    ],
    investigationZh: [
      "檢查目標服務是否啟動。",
      "測試主機與埠的連線能力。",
      "檢查防火牆、網路與 DNS。",
      "檢查連線池設定與目前使用量。",
      "檢查連線兩端的近期部署。",
    ],
    suggestedFixesZh: [
      "重啟或恢復目標服務。",
      "修正主機、埠或憑證設定。",
      "釋放閒置連線並調整連線池大小。",
    ],
    longTermImprovementsZh: [
      "加入連線健康檢查與自動重連。",
      "將連通性列為黃金訊號監控。",
    ],
  },
  "http-error": {
    rootCausesZh: [
      "後端回傳錯誤狀態碼（見 HTTP status）。",
      "下游 API 不可用或拒絕請求。",
      "客戶端送出無效輸入或缺少認證。",
    ],
    investigationZh: [
      "確認 HTTP 狀態碼與受影響的端點。",
      "在下游 API 日誌中查找同一請求。",
      "檢查請求內容是否有效。",
      "檢查被呼叫服務的近期部署。",
    ],
    suggestedFixesZh: [
      "以明確錯誤明確處理該狀態碼。",
      "對可重試的冪等請求在暫態 5xx 時重試。",
      "修正請求內容或認證。",
    ],
    longTermImprovementsZh: [
      "提供結構化錯誤碼讓客戶端可處理失敗。",
      "建立服務層級的狀態儀表板。",
    ],
  },
  authentication: {
    rootCausesZh: [
      "Token 過期或無效。",
      "認證伺服器不可用或拒絕請求。",
      "憑證錯誤。",
      "OAuth/OIDC 設定問題（issuer、audience、scope）。",
    ],
    investigationZh: [
      "檢查 token 的過期與簽發時間。",
      "檢查認證伺服器的健康狀態與日誌。",
      "核對設定中的憑證。",
      "檢視 OAuth/OIDC 的 issuer、audience 與 scope 設定。",
    ],
    suggestedFixesZh: [
      "重新整理或重新簽發 token。",
      "更新設定中的憑證。",
      "修正 OAuth/OIDC 設定。",
    ],
    longTermImprovementsZh: [
      "加入自動 token 輪換。",
      "對認證失敗激增發出告警。",
    ],
  },
  validation: {
    rootCausesZh: [
      "傳入服務的輸入無效或格式錯誤。",
      "呼叫端與被呼叫端之間的 schema/格式不一致。",
      "資料庫約束違反。",
    ],
    investigationZh: [
      "找出無效欄位及其預期格式。",
      "檢查 API 的呼叫端。",
      "檢查失敗記錄的資料庫約束。",
    ],
    suggestedFixesZh: [
      "修正呼叫端輸入以符合預期格式。",
      "向呼叫端回傳具描述性的驗證錯誤。",
    ],
    longTermImprovementsZh: [
      "以清楚錯誤碼集中輸入驗證。",
      "在元件之間加入契約測試。",
    ],
  },
  "out-of-memory": {
    rootCausesZh: [
      "堆積空間耗盡。",
      "記憶體洩漏（無上限的快取或清單）。",
      "同時請求過多或 payload 過大。",
    ],
    investigationZh: [
      "檢查失敗前後的剩餘堆積與 GC 日誌。",
      "找出最大的配置（heap dump / profiler）。",
      "檢查程式路徑中是否有無上限的集合或快取。",
      "檢查近期流量或批次大小的變更。",
    ],
    suggestedFixesZh: [
      "重啟實例以恢復服務。",
      "分析堆積並修復最大的配置。",
    ],
    longTermImprovementsZh: [
      "加入堆積使用率監控與告警。",
      "修復記憶體洩漏並限制快取/批次大小。",
    ],
  },
  "file-not-found": {
    rootCausesZh: [
      "所參考的檔案不存在。",
      "路徑錯誤或權限不足。",
      "檔案被刪除或未掛載。",
    ],
    investigationZh: [
      "確認檔案存在於所參考的路徑。",
      "檢查檔案系統權限。",
      "檢查近期部署或掛載變更。",
    ],
    suggestedFixesZh: [
      "建立或還原該檔案。",
      "修正路徑或權限。",
    ],
    longTermImprovementsZh: [
      "必要檔案缺失時在啟動時快速失敗。",
      "集中管理檔案路徑設定。",
    ],
  },
  "connection-pool": {
    rootCausesZh: [
      "連線池大小不足以應付請求流量。",
      "連線從未關閉而洩漏。",
      "長時間查詢或交易佔住連線。",
      "資料庫接受新連線的速度變慢。",
    ],
    investigationZh: [
      "檢查失敗當下連線池設定與使用率。",
      "尋找取得連線卻未關閉的程式路徑。",
      "檢查是否有長時間查詢或未提交的交易。",
      "檢查資料庫端的 session 數。",
    ],
    suggestedFixesZh: [
      "調大連線池或加入取得重試（backoff）。",
      "可靠地關閉連線（使用 try/finally 或框架管理連線池）。",
      "縮短每個請求佔用連線的時間。",
    ],
    longTermImprovementsZh: [
      "監控連線池使用率，於耗盡前發出告警。",
      "在測試中加入連線洩漏偵測。",
    ],
  },
  "thread-pool": {
    rootCausesZh: [
      "緩慢或阻塞的任務佔滿執行緒池。",
      "在請求執行緒上執行阻塞式 I/O（DB、HTTP）。",
      "並發請求超過執行緒池容量。",
    ],
    investigationZh: [
      "檢查失敗當下執行緒池大小、活動執行緒與佇列堆積。",
      "尋找池內任務中的阻塞呼叫（資料庫、HTTP）。",
      "檢查失敗時段的請求速率。",
    ],
    suggestedFixesZh: [
      "將阻塞工作移至獨立、有界佇列的 executor。",
      "為內部呼叫加入逾時，避免任務永久阻塞。",
      "施加背壓（例如以 503 拒絕，而非無限佇列）。",
    ],
    longTermImprovementsZh: [
      "監控執行緒池使用率與任務佇列深度。",
      "將長呼叫鏈重構為 async/事件驅動。",
    ],
  },
  "ssl-tls": {
    rootCausesZh: [
      "雙方協定或加密套件不匹配。",
      "憑證鏈問題（缺少中繼憑證、主機名稱錯誤）。",
      "TLS 版本或 SNI 設定不匹配。",
      "中介（proxy/防火牆）干擾 TLS 握手。",
    ],
    investigationZh: [
      "比對雙方設定的 TLS 版本與加密套件。",
      "驗證完整憑證鏈與信任庫。",
      "檢查伺服器端與客戶端的 SNI 與 TLS 設定。",
      "檢查是否有中間設備改寫或阻擋握手。",
    ],
    suggestedFixesZh: [
      "對齊雙方 TLS 設定。",
      "更新失敗端的 CA 憑證包/信任庫。",
      "修正憑證（主機名稱/SAN、鏈、到期日）。",
    ],
    longTermImprovementsZh: [
      "集中管理 TLS 設定並一致地滾動套用。",
      "在部署管線中加入 TLS 版本/加密套件矩陣測試。",
    ],
  },
  "json-parse": {
    rootCausesZh: [
      "呼叫端送出格式錯誤的 payload。",
      "Content-Type 或字元編碼錯誤。",
      "請求或回應主體被截斷。",
      "生產端與消費端版本之間的 schema 變更。",
    ],
    investigationZh: [
      "用 JSON linter 驗證該 payload。",
      "找出呼叫端並檢查其 content-type 宣告。",
      "檢查傳輸過程中的截斷（proxy、buffer）。",
    ],
    suggestedFixesZh: [
      "及早以清楚錯誤碼拒絕無效 payload。",
      "修正呼叫端的序列化或 content type。",
      "處理大型或串流主體時避免截斷。",
    ],
    longTermImprovementsZh: [
      "在雙端加入帶契約測試的 schema 驗證。",
      "記錄 payload 大小與編碼中繼資料以利除錯。",
    ],
  },
  serialization: {
    rootCausesZh: [
      "生產端與消費端的類別版本不匹配。",
      "schema 演進不相容（新增/移除/改名欄位）。",
      "缺少預設建構函式或不支援的欄位型別。",
    ],
    investigationZh: [
      "比對雙方類別版本與 serialVersionUID。",
      "在 schema registry 檢查被序列化的型別。",
      "檢視被序列化的物件圖。",
    ],
    suggestedFixesZh: [
      "對齊類別版本，或改序列化明確的 DTO。",
      "讓 schema 變更向後相容。",
      "加入預設建構函式與受支援的型別。",
    ],
    longTermImprovementsZh: [
      "採用帶相容性政策的 schema registry。",
      "在 CI 中加入序列化往返測試。",
    ],
  },
  "disk-full": {
    rootCausesZh: [
      "日誌或暫存檔填滿分割區。",
      "應用資料增長而無清理。",
      "小型檔案系統的 inode 耗盡。",
    ],
    investigationZh: [
      "檢查分割區使用率（df -h）與相關檔案系統。",
      "找出最大的消費者（日誌、暫存、資料檔）。",
      "確認日誌輪替確實有在執行。",
    ],
    suggestedFixesZh: [
      "立即釋放空間，必要時重啟受影響服務。",
      "設定日誌輪替與壓縮。",
      "將資料移至更大或專屬磁碟。",
    ],
    longTermImprovementsZh: [
      "以門檻值與告警監控磁碟使用率。",
      "為暫存與舊日誌加入自動清理政策。",
    ],
  },
  permission: {
    rootCausesZh: [
      "檔案或目錄的所有者或權限模式錯誤。",
      "服務以與資源所有者不同的使用者執行。",
      "安全性政策（SELinux / AppArmor / OS ACL）阻擋存取。",
    ],
    investigationZh: [
      "檢查失敗路徑的所有者與權限模式。",
      "比對服務帳號與資源所有者。",
      "檢查路徑的作業系統安全政策。",
    ],
    suggestedFixesZh: [
      "修正所有者或權限模式以符合服務使用者。",
      "修正服務帳號設定。",
      "更新安全政策以允許預期的存取。",
    ],
    longTermImprovementsZh: [
      "將所有者/權限模式當作基礎設施即程式碼管理。",
      "定期檢視最小權限設定。",
    ],
  },
  "slow-query": {
    rootCausesZh: [
      "缺少或未使用的索引導致全表掃描。",
      "與其他交易的鎖競爭。",
      "統計資料過舊導致執行計畫不佳。",
    ],
    investigationZh: [
      "為失敗的查詢取得執行計畫（EXPLAIN）。",
      "檢查 WHERE 與 JOIN 欄位的索引使用。",
      "檢查並發交易與鎖等待。",
    ],
    suggestedFixesZh: [
      "在篩選與關聯欄位新增或調整索引。",
      "重寫查詢或拆成較小的步驟。",
      "更新相關資料表的統計資料。",
    ],
    longTermImprovementsZh: [
      "在一般發版流程中檢視查詢計畫。",
      "對慢查詢門檻與鎖等待發出告警。",
    ],
  },
  "rate-limit": {
    rootCausesZh: [
      "突發流量超過限速。",
      "訂閱/方案配額耗盡。",
      "客戶端無退避地重試，形成重試風暴。",
      "共用憑證被其他使用者消耗配額。",
    ],
    investigationZh: [
      "在閘道日誌檢查 rate-limit 標頭與計數。",
      "檢視失敗當下每個客戶端/憑證的呼叫量。",
      "尋找放大流量的緊密重試迴圈。",
    ],
    suggestedFixesZh: [
      "重試時用帶抖動的指數退避。",
      "合理情況下調高配額或方案。",
      "快取或批次重複呼叫以減少流量。",
    ],
    longTermImprovementsZh: [
      "讓客戶端感知限速（尊重 Retry-After）。",
      "監控限額餘量並於耗盡前告警。",
    ],
  },
  "circuit-breaker": {
    rootCausesZh: [
      "下游不健康，熔斷器因失敗而開啟。",
      "在時間窗內超過失敗或逾時門檻。",
      "下游緩慢使熔斷器持續開啟。",
    ],
    investigationZh: [
      "檢查下游服務健康狀態及其日誌。",
      "檢視熔斷器設定（門檻、時間窗、逾時）。",
      "檢查時間窗內下游的錯誤率。",
    ],
    suggestedFixesZh: [
      "修復或重啟下游服務讓熔斷器重置。",
      "只有在有指標佐證時才調整門檻。",
      "提供有意義的 fallback，而非直接失敗。",
    ],
    longTermImprovementsZh: [
      "為熔斷器開/關狀態設定 SLO 與儀表板。",
      "在故障注入演練中測試熔斷行為。",
    ],
  },
  messaging: {
    rootCausesZh: [
      "Broker 停機或不可達。",
      "消費群組落後或 rebalance 迴圈。",
      "訊息超過 broker 大小限制。",
      "Topic 或 partition 消失 / ACL 拒絕。",
    ],
    investigationZh: [
      "檢查 broker 健康、partition 與儲存。",
      "檢查消費群組落後與 rebalance 活動。",
      "比對訊息大小與 max.message.bytes。",
      "核對生產端與消費端的 topic ACL。",
    ],
    suggestedFixesZh: [
      "重啟或修復 broker，確認副本同步。",
      "修正消費群組 offset 策略或增加 partition。",
      "調整訊息或批次大小限制。",
    ],
    longTermImprovementsZh: [
      "監控消費落後與 broker 容量。",
      "為每個 topic 定義保留與壓縮政策。",
    ],
  },
  cache: {
    rootCausesZh: [
      "快取伺服器停機、重啟，或在記憶體壓力下逐出。",
      "maxmemory 政策逐出熱鍵。",
      "寫入端與讀取端之間的序列化或型別不匹配。",
    ],
    investigationZh: [
      "檢查快取伺服器健康、記憶體與逐出統計。",
      "檢查失敗前後的 key 命中/未命中率。",
      "核對失敗 key 所儲存的資料。",
    ],
    suggestedFixesZh: [
      "重啟或修復快取伺服器，重新預熱熱鍵。",
      "調整 maxmemory-policy 與 TTL。",
      "對齊讀寫端的序列化。",
    ],
    longTermImprovementsZh: [
      "快取不可用時優雅降級。",
      "監控逐出率與記憶體餘量。",
    ],
  },
  dns: {
    rootCausesZh: [
      "DNS 伺服器停機或回應緩慢。",
      "記錄被移除或更新了錯誤的 zone。",
      "搜尋網域或 resolver 設定不匹配。",
    ],
    investigationZh: [
      "用 nslookup/dig 解析主機並比對答案。",
      "檢查節點上的 resolver 設定。",
      "比對各 DNS 伺服器與 zone 的記錄。",
    ],
    suggestedFixesZh: [
      "修正或更新 DNS 記錄。",
      "修正 resolver 設定。",
      "為關鍵主機加入備援 resolver 或 hosts 項目。",
    ],
    longTermImprovementsZh: [
      "監控 DNS 解析延遲與失敗。",
      "在應用內以 TTL 感知方式快取 DNS。",
    ],
  },
  "batch-job": {
    rootCausesZh: [
      "一條壞輸入記錄中止整個 chunk。",
      "批次規模下的資料庫鎖競爭。",
      "Job 內的外部呼叫逾時。",
      "Job 未正確 checkpoint 就重啟。",
    ],
    investigationZh: [
      "在 job 日誌中找出失敗的 chunk 與 step。",
      "找出第一條壞記錄及其內容。",
      "核對該 job 的重啟/checkpoint 行為。",
    ],
    suggestedFixesZh: [
      "跳過或隔離壞記錄，而非中止整批。",
      "在 chunk 內隔離單筆記錄的失敗。",
      "從最後的 checkpoint 重啟 job。",
    ],
    longTermImprovementsZh: [
      "將 job 設計為冪等且可回復。",
      "對 job 失敗發出告警並追蹤完成 SLA。",
    ],
  },
  configuration: {
    rootCausesZh: [
      "缺少環境變數或機密。",
      "設定檔中的數值錯誤或過時。",
      "profile 不匹配（dev 設定用在 prod 或反之）。",
      "屬性名稱拼錯。",
    ],
    investigationZh: [
      "比對各環境的設定差異。",
      "檢查環境變數與機密庫。",
      "確認啟用的 profile 及其來源優先順序。",
    ],
    suggestedFixesZh: [
      "為該環境設定正確數值或機密。",
      "修正設定檔或屬性名稱。",
      "讓啟用 profile 與部署一致。",
    ],
    longTermImprovementsZh: [
      "啟動時驗證設定（快速失敗並給清楚訊息）。",
      "加入設定 schema 測試並集中管理機密。",
    ],
  },
  certificate: {
    rootCausesZh: [
      "憑證過期或尚未生效。",
      "憑證鏈缺少中繼 CA。",
      "主機名稱不符（憑證的 SAN 錯誤）。",
      "任一方系統時鐘偏差。",
    ],
    investigationZh: [
      "檢查憑證日期、SAN 與鏈（openssl s_client）。",
      "檢查失敗端的信任庫。",
      "比對雙方系統時鐘。",
    ],
    suggestedFixesZh: [
      "更新並重新部署憑證。",
      "安裝完整中繼鏈。",
      "修正呼叫服務所用的主機名稱（或 SAN）。",
    ],
    longTermImprovementsZh: [
      "監控憑證到期（例如提前 30 天告警）。",
      "自動化續期與鏈部署。",
    ],
  },
  websocket: {
    rootCausesZh: [
      "閒置逾時關閉連線。",
      "proxy/負載平衡器閒置逾時比應用程式短。",
      "伺服器重啟或部署中斷活動連線。",
      "客戶端與伺服器之間的網路中斷。",
    ],
    investigationZh: [
      "比對 proxy/LB 閒置逾時與客戶端 ping 間隔。",
      "檢查失敗當下是否有重啟或部署。",
      "檢查端點之間的網路穩定性。",
    ],
    suggestedFixesZh: [
      "在客戶端加入 ping/pong 保活。",
      "對齊 proxy 與應用程式逾時。",
      "以指數退避實作重連。",
    ],
    longTermImprovementsZh: [
      "將心跳與自動重連列為客戶端標準。",
      "監控 WebSocket 連線數與斷線數。",
    ],
  },
  encoding: {
    rootCausesZh: [
      "生產端與消費端編碼混用。",
      "連線或檔案缺少 charset 宣告。",
      "二進位資料被放入文字欄位。",
    ],
    investigationZh: [
      "比對宣告的 charset 與實際位元組內容。",
      "找出錯誤編碼字串的來源。",
      "檢查原始位元組樣本（hexdump）。",
    ],
    suggestedFixesZh: [
      "端到端統一使用 UTF-8。",
      "在連線、檔案與回應宣告 charset。",
      "在邊界拒絕非文字資料。",
    ],
    longTermImprovementsZh: [
      "跨服務強制編碼政策。",
      "在資料管道加入編碼驗證。",
    ],
  },
};

/** Generic investigation tail (English -> Traditional Chinese). */
export const GENERIC_INVESTIGATION_ZH: Record<string, string> = {
  "Check input data.": "檢查輸入資料。",
  "Check recent deployment.": "檢查近期部署。",
  "Check upstream application.": "檢查上游應用程式。",
  "Review database result.": "檢視資料庫結果。",
  "Check related logs.": "檢查相關日誌。",
};

export const UNKNOWN_ZH = {
  causes: "沒有已知規則符合此錯誤模式；錯誤訊息或堆疊追蹤是最好線索。",
  fixes: "在程式碼與相關日誌中搜尋確切的錯誤文字。",
  fixClient: "驗證被拒絕呼叫的請求內容、認證與權限。",
  fixServer: "檢查接收服務的健康狀態與日誌，再追蹤上游呼叫鏈。",
  longTerm: "為此錯誤模式新增規則，讓它下次能被辨識。",
  stack: "從第一個堆疊框架開始，沿「Caused by」鏈找出根本原因。",
  directionClient: "呼叫以 4xx 被拒絕：請求、其憑證或權限很可能是問題所在。",
  directionServer: "失敗發生在伺服器端（5xx）：檢查接收服務及其上游依賴。",
};

/** Unmatched-exception triage hints by label (from triage.ts). */
export const TRIAGE_ZH: Record<
  string,
  { causesZh: string[]; investigationZh: string[] }
> = {
  "data type or format": {
    causesZh: [
      "此異常通常來自型別或格式錯誤的資料（例如本應為數值卻收到非數值）。",
    ],
    investigationZh: ["找出解析失敗的欄位或數值及其來源。"],
  },
  "type cast": {
    causesZh: ["數值被轉型為不相容型別——通常是元件之間的 schema 漂移。"],
    investigationZh: ["比對數值的執行期型別與程式預期的型別。"],
  },
  "null / undefined value": {
    causesZh: ["null 或 undefined 數值被解引用——追查該數值的來源。"],
    investigationZh: ["檢查第一個堆疊框架與傳入其中的數值。"],
  },
  "invalid application state": {
    causesZh: [
      "應用程式進入無效狀態（物件關閉後仍在使用，或操作被執行兩次）。",
    ],
    investigationZh: ["檢查失敗前一刻的狀態轉換。"],
  },
  "I/O failure": {
    causesZh: ["I/O 操作在網路或檔案系統層面失敗。"],
    investigationZh: ["檢查目標資源（網路路徑、檔案、socket）與近期網路變更。"],
  },
  "deployment / version mismatch": {
    causesZh: [
      "建置時可用的類別或模組在執行期缺失或不匹配——通常是部署或版本不一致。",
    ],
    investigationZh: ["比對部署產物版本與預期版本，並檢查 classpath。"],
  },
  recursion: {
    causesZh: ["無界遞迴或永不終止的呼叫迴圈。"],
    investigationZh: ["在前幾個堆疊框架尋找沒有基準條件的遞迴呼叫。"],
  },
  interruption: {
    causesZh: ["執行緒在等待時被中斷——檢查關閉或取消流程。"],
    investigationZh: ["檢查誰在取消任務及其原因。"],
  },
  parsing: {
    causesZh: ["數值無法解析為預期格式（日期、數字等）。"],
    investigationZh: ["檢查呼叫程式碼中的原始數值與預期格式。"],
  },
  "internal invariant": {
    causesZh: ["內部不變量失敗——是程式碼層面的錯誤，而非環境問題。"],
    investigationZh: ["檢查第一個堆疊框架中的失敗斷言及其違反的狀態。"],
  },
  "unsupported operation": {
    causesZh: ["此實作或版本不支援該操作。"],
    investigationZh: ["檢查功能旗標與版本相容性。"],
  },
  "generic exception": {
    causesZh: [
      "沒有特定簽名的通用異常；訊息文字是最主要的線索。",
    ],
    investigationZh: ["仔細閱讀異常訊息與第一個堆疊框架。"],
  },
};