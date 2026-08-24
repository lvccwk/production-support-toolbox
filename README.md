# Production Support Toolbox

A **local-first, agent-first** toolbox for developers and production support
engineers: analyse logs, inspect technical data, troubleshoot incidents and
perform common support tasks. Everything is **deterministic, local and
free** — no AI, no external services, nothing leaves the machine.

Built with **Next.js + TypeScript + Tailwind CSS + SQLite (`better-sqlite3`)**.
No database server, no Redis, no Kubernetes, no external authentication.
Docker is optional (a convenience fallback — the primary path needs only
Node.js).

---

## Setup

One command, no prior knowledge required. You need **Node.js ≥ 20 (LTS)**
(or Docker, as a fallback — see below).

| Platform | Command |
| --- | --- |
| macOS / Linux | `./scripts/setup.sh` |
| Windows | `setup.bat` (double-click, or run in cmd/PowerShell) |
| 任何平台(已有 Node) | `npm run setup` |

Each variant does the same thing: checks the Node version → `npm install`
(with an automatic fallback to a project-local npm cache if the global npm
cache is broken) → creates `.env` from `.env.example` if missing → makes sure
`data/` exists. Then start the app:

```bash
npm run dev
```

Open http://localhost:3000. The first page is a **Welcome screen** with a
"30-second demo" button (analyses a bundled sample log) and a card grid of
all tools — new users can see value before reading any docs. Returning users
land back on the tool they used last time.

> **Windows:** `better-sqlite3` is a native module; it normally ships a
> prebuilt binary so no compiler is needed, and the GitHub CI
> (`windows-smoke` workflow) verifies this on every PR. If you ever hit a
> `node-gyp` / build-tools error, see [docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md).

> **Docker (optional fallback):** if a colleague has Docker but can't or
> won't install Node — `docker compose up -d`, then open
> http://localhost:3000. Data is kept in `./data` via a volume. See
> [docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md) too for when this is the
> easiest path on Windows.

The application works fully offline after installation.

> ## ⚠️ Deployment warning
>
> This is an **internal MVP for personal / small-team localhost use**. The
> dev/start commands bind to **127.0.0.1 (loopback only)** and the data APIs
> are **unauthenticated by default** — **do NOT expose the service to your
> LAN or the Internet without enabling remote access** (see
> [Remote mode & API access control](#remote-mode--api-access-control)).

## Testing

```bash
npm test          # vitest: unit + integration + security + performance tests
npm run lint      # ESLint (eslint-config-next)
npm run typecheck # tsc --noEmit
```

## Evaluating the rule engine on real logs

```bash
npm run eval                 # scans data/loghub/*.log (LogHub-style datasets)
npm run eval -- --dir <dir>  # point it at any folder with *.log files
```

For each file it reports flagged lines, the top firing rules and the
processing time. When `anomaly_labels.txt` is present next to the logs
(OpenStack / LogHub convention: a list of anomalous VM instance UUIDs),
line-level **precision / recall / F1** are computed for the `*abnormal*`
file — for the rule engine and for a plain `ERROR`-level keyword baseline —
so you can see whether the engine adds value over a trivial heuristic.

Caveats printed by the tool matter: OpenStack anomalies are behavioural
(e.g. failed pings, latency) and mostly **do not carry `ERROR` keywords**,
so a crash/exception-tuned rule engine scores near-zero recall there — that
is an honest measurement of domain mismatch, not a bug. Java-stack-heavy
datasets (e.g. Hadoop / HDFS_v1) fit the engine's design much better.

## Build

```bash
npm run build     # production build (Turbopack)
npm run start     # serve the production build (bound to 127.0.0.1)
```

## Remote mode & API access control

The service is **loopback-only by default** (`next dev` / `next start` bind
`127.0.0.1` explicitly). If you genuinely need LAN/team access, opt in
deliberately — remote mode is **fail-closed**:

```bash
# 1. Generate high-entropy tokens (at least 16 chars)
#    e.g. openssl rand -hex 32   -> 64 chars, ideal
export PST_API_TOKEN="<admin token>"      # full access
export PST_API_TOKEN_WRITE="<write token>" # read + write, no delete/import/export
export PST_API_TOKEN_READ="<read token>"   # read-only

# 2. Start with the :remote script (refuses to start without credentials!)
PST_REMOTE_ACCESS=true npm run dev:remote     # binds 0.0.0.0
PST_REMOTE_ACCESS=true npm run start:remote   # production build, binds 0.0.0.0
```

Rules:

- `Authorization: Bearer <token>` only — query-string tokens are rejected.
- Scopes: **read < write < admin**. `read` = list/get on incidents, history,
  rules; `write` = create/update; `admin` = delete, import/export and the
  rules import endpoint. A token grants its scope and everything below it.
- Without any credential, remote mode returns `503` on every protected
  endpoint and the `:remote` scripts refuse to start (fail closed).
- Browser-originated writes are CSRF-checked: a cross-origin `Origin` header
  must match the request host or `PST_ALLOWED_DEV_ORIGINS`, otherwise `403`.
  Agents (no `Origin` header) only need the bearer token.
- Tokens live in environment variables only: they never appear in responses,
  logs, history, exports or the database.
- The GUI has a Settings field to store a token in the browser's
  `localStorage`; every request goes through `apiFetch`, which attaches
  `Authorization: Bearer` automatically.
- For a real multi-user deployment prefer a **reverse proxy + OIDC** instead
  of extending this built-in token model.

| Env var | Effect |
| --- | --- |
| `PST_REMOTE_ACCESS=true` + `PST_API_TOKEN` | enable remote mode (binds 0.0.0.0) with admin token |
| `PST_API_TOKEN_WRITE` / `PST_API_TOKEN_READ` | scoped tokens (optional extra) |
| `PST_ALLOWED_DEV_ORIGINS` | comma-separated origins for dev resources / CSRF allow-list |
| `PST_MAX_CUSTOM_RULES` | active custom-rule cap (default 200) |
| `PST_MAX_ALERT_RULES` | active alert-rule cap (default 100) |
| `PST_ALERTS_ENABLED=off` | disable alert evaluation entirely (rules stay configurable) |
| `PST_ALERT_WEBHOOK_TIMEOUT_MS` | webhook delivery timeout (default 5000) |
| `PST_ALERT_MAX_ATTEMPTS` | webhook delivery attempts before giving up (default 3) |
| `PST_ALERT_WORKER_INTERVAL_MS` | background worker poll interval (default 30000) |
| `PST_BACKUP_RETENTION` | days of `backups-*.json` to keep (default 30) |
| `PST_AUTO_BACKUP=off` | disable the daily auto-backup |
| `PST_DATA_DIR` | SQLite file location override |
| `PST_AI_FALLBACK=true` + `OPENROUTER_API_KEY` | opt-in AI fallback (see Privacy model) |

---

## Features (Version 1)

| Module | What it does |
| --- | --- |
| **Log Analyzer** | Paste application logs → severity, error types, possible root cause, affected components, immediate investigation, suggested fix, long-term improvement. Plus automatic extraction: timestamps, levels, components, `transactionId` / `requestId` / `traceId` / `correlationId` / `sessionId` / `userId`, exceptions, source files & line numbers, HTTP statuses, stack-trace detection. On zero rule matches the rule-result dashboard auto-collapses (expandable) so the AI fallback analysis takes focus. |
| **Log Comparison** | Paste two logs (Before / After) → new errors, missing errors, changed HTTP codes (`200 → 500`), changed exception types / components / error lines, regression verdict. |
| **JSON Toolbox** | Format, validate (with position), minify, search keys/values (e.g. `transactionId`, `status`, `errorCode`). Copy / clear everywhere. |
| **SQL Toolbox** | Text-only tools — never connects to a database. Format SQL, safety check (`DELETE`/`DROP`/`TRUNCATE`, `UPDATE`/`DELETE` without `WHERE` → WARNING), basic analysis (statement type, tables, WHERE, JOIN, ORDER BY, GROUP BY, LIMIT, `?` parameters). |
| **Timestamp Converter** | Unix seconds / milliseconds, ISO 8601, UTC and local wall clock in any IANA timezone (default `Asia/Hong_Kong`). Naive datetimes are interpreted in the selected timezone. |
| **Base64 / URL** | UTF-8-safe Base64 encode/decode, URL encode (`hello world` → `hello%20world`) / decode. |
| **Incident Notes** | Incident records (title, system, environment, severity, detected time, symptoms, root cause, immediate fix, permanent fix, status, notes) stored in SQLite. Search, edit, delete. |
| **Support History** | Explicitly saved analyses (date, tool, system, summary, severity). Search, delete, **re-open** (the original inputs are restored in the tool). Nothing is stored automatically. |
| **Dashboard** | Aggregated report over saved analyses + incidents — 總數 / High+ 佔比 / AI-fallback 次數 / 開嘅 incidents，severity 分佈、top error types（直接喺 SQLite 用 JSON1 由儲存嘅分析快照聚合）、工具用量、系統 Top 10、每日 High+ 趨勢。唔使開 CSV 都睇到趨勢。一鍵匯出：**報表 CSV**（sectioned 聚合數據，client 本地生成，唔包原始 log）。完整原始記錄（含 payload）只喺 Settings 嘅 history 匯出提供。 |
| **Custom Rules** | Custom-rules 嘅人用 GUI：瀏覽／新增／編輯／啟停／刪除規則（scope、patterns、severity、分析輸出欄位），每次儲存行足 server 全套驗證（regex 語法 + ReDoS 篩查 + torture test）。非技術用戶唔使掂 API。 |
| **Alerts** | Alert rules + 通知記錄：規則對「Save Analysis」呢一刻評估（minSeverity ≥、可選 errorTypes / systems / tools 過濾），中咗一定記錄站內通知；webhook（generic POST JSON —— Teams / Slack / 任何嘢）由背景 worker **非同步送出**（Save 即時回應、失敗自動 retry + backoff，唔會拖慢儲存），per-signal cooldown 防轟炸。「Send Test」即場驗證 webhook。 |
| **Settings** | Backup / export / import (JSON bundle or per-table CSV) and a pointer to the Agent API. The JSON backup is schema v2 and covers **incidents + history + custom rules**; imports are all-or-nothing (any invalid entry rolls the whole bundle back, duplicates skipped). CSVs are **spreadsheet-safe** (formula-injection prefixes `= + - @` neutralized). History CSV includes derived columns (`analysisSource`, `matchedRuleCount`, `errorTypes`, `affectedComponents`, bilingual `possibleRootCause` / `immediateInvestigation` / `suggestedFixes` / `longTermImprovements`, plus `inputChars`, `inputPreview`, tool `detail`, `sensitive`); `createdAt` is written as Hong Kong local wall clock (`YYYY-MM-DD HH:mm:ss`, UTC+8) instead of raw ISO so spreadsheets look sane. The JSON backup carries a parsed `analysis` object on every history entry so no one has to open raw payloads. The Agent API section links the machine-readable OpenAPI document (`/api/openapi.json`). |

Every tool follows the same pattern: **Input → Action buttons → Result →
Copy → Clear**, with large monospace text areas, dark mode, and desktop-first
responsive layout. The **exact same logic** is exposed to agents via the
[Agent API](#agent-api) below.

## Privacy model

- All processing happens **locally** in your browser or in the local Node
  process.
- Nothing is uploaded and no external services are called (the npm registry
  at install time is the only network access). No telemetry, no analytics, no
  external tracking (Next.js telemetry is disabled in the npm scripts).
- **Exception (opt-in):** when `PST_AI_FALLBACK=true` (+ `OPENROUTER_API_KEY`)
  is set, an analysis that matches **zero rules** automatically sends the
  **masked** log excerpt to OpenRouter once (result cached per hash — repeat
  = zero cost). The GUI shows a live progress panel (rule scan → AI call →
  result) whenever this runs, and marks every response with
  `analysisSource: "ai-fallback"`. Disabled by default; never triggered when
  rules match. **Chinese output is hard-converted to Traditional Chinese
  (繁體中文):** every `*Zh` field passes through a deterministic OpenCC
  conversion before being cached/displayed/saved, so Simplified Chinese
  (简体) can never reach the GUI, history or exports.
- **The AI call streams.** The GUI consumes `POST /api/tools/analyze/stream`
  (SSE: `phase` / `delta` / `ai_result` / `error` / `done`) — the model's
  tokens appear in the progress panel as they are generated instead of after
  a blank wait. The agent-facing `POST /api/tools/analyze` is unchanged
  (single JSON). Generation is capped at 1600 tokens
  (`FALLBACK_MAX_TOKENS`) and each prompt line is truncated to 300 chars, so
  a large masked log cannot inflate generation time or cost.
- `/api/tools/analyze` masks sensitive values (`password`, `token`,
  `authorization`, `api_key`, `client_secret`, …) in its response by default
  (`PST_REDACT=off` disables).
- API requests emit **structured metadata logs** to stdout (one JSON line per
  request: `requestId`, route, duration, status, error class). They never
  include log content, request payloads, Authorization headers, API keys,
  PII, or full SQLite errors.
- Before saving an analysis, the app scans for common sensitive keywords and
  shows a warning; it never sanitises automatically — review content yourself
  before saving.

## How the log rule engine works

`src/lib/rules/` implements a deterministic, keyword/pattern-based engine
(the default analysis — no LLM involved):

1. `src/lib/log-parser/parser.ts` extracts structured fields from the raw
   text: timestamps, log levels, components, identifiers, exception class
   names, stack frames (`file:line`), HTTP statuses.
2. `src/lib/rules/rules.ts` defines the static rule catalogue
   (NullPointerException, SQL/DB errors, Timeout, Connection Failure, HTTP
   errors, Authentication, Validation, OutOfMemory, File Not Found) with
   severity, root causes, investigation steps, suggested fixes and
   long-term improvements per rule.
3. `src/lib/rules/engine.ts` runs every rule against the log, merges the
   matched guidance, deduplicates, sets the overall severity (base severity,
   escalated by FATAL/CRITICAL levels, outage keywords and 5xx codes) and
   adds contextual root causes (e.g. a null-dereference tied to the exact
   class from the stack trace). Unmatched `ERROR`/`FATAL` logs fall back to
   “Unknown Error”.

The engine is pure and unit-tested (`src/lib/rules/engine.test.ts`); adding
a new detection is just adding one entry to `RULES`.

## Agent API（給 AI Agent 用）

The web GUI is for humans; agents get a **self-describing, stateless, local
API** over the exact same logic:

```bash
# 1. Discover all tools (input shape + example per tool)
curl http://localhost:3000/api/tools

# 2. Deterministic log analysis — local, free, instant
curl -X POST http://localhost:3000/api/tools/analyze \
  -H "Content-Type: application/json" \
  -d '{"logs":["2026-08-21 10:15:22 ERROR PaymentBatch java.lang.NullPointerException at PaymentService.java:125"],"system":"PaymentBatch"}'

# 3. Every other toolbox is one endpoint away
curl -X POST http://localhost:3000/api/tools/sql \
  -H "Content-Type: application/json" \
  -d '{"input":"UPDATE customer SET status=\x27X\x27;","action":"safety"}'
```

Available tools (`POST /api/tools/<id>`):

| id | what it does |
| --- | --- |
| `analyze` | rule-engine log analysis (severity, evidence, extracted fields, quantitative summary) + incident dossier — every text section in **English + Traditional Chinese**; zero matches auto-triggers the opt-in AI fallback (`analysisSource: "ai-fallback"`, streamed live to the GUI via `/api/tools/analyze/stream`) |
| `compare` | before/after log comparison + regression verdict |
| `json` | format / validate / minify / search |
| `sql` | format / safety check / basic analysis (text-only, never executes) |
| `timestamp` | Unix / ISO / UTC / local conversion in any IANA timezone |
| `encoding` | Base64 / URL encode-decode |
| `rules` | scoped custom rule registry (see below) |

Data endpoints are also agent-callable: `/api/incidents` (CRUD),
`/api/history` (search with `?q=`), `/api/export`, `/api/import`.
Reporting/alerts endpoints: `GET /api/dashboard` (aggregated summary),
`/api/alerts` (rules CRUD + `[id]/test` send-test), `GET/DELETE
/api/notifications` (the alert-firing log). The whole surface is
documented machine-readably: **`GET /api/openapi.json`** (OpenAPI 3.1 —
paths, scopes, schemas, examples; tools stay `security: []`, data routes
list `bearerAuth`), so an agent can onboard without reading this page.

- Every `/api/tools/*` call is **pure local + deterministic + free**: fixed
  JSON contract, `{ ok: true, data }` on success, `{ ok: false, error, message }`
  on failure. Errors carry a stable structured body:
  `{ code, message, requestId }` with codes `VALIDATION_ERROR` (400),
  `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404),
  `PAYLOAD_TOO_LARGE` (413), `SERVICE_UNAVAILABLE` (503), `INTERNAL_ERROR`
  (500). Internal exceptions are never echoed — the client always gets a
  generic `INTERNAL_ERROR` plus a `requestId` you can correlate in the
  server log (structured `{"pst":true,...}` JSON lines: requestId, route,
  duration, status, error class — never payloads, headers or credentials).
- **Authentication:** local (loopback) mode requires none. When
  `PST_REMOTE_ACCESS=true` (or any token is configured) every data route
  requires `Authorization: Bearer <token>` with the matching scope
  (read/write/admin — see "Remote mode & API access control"). The pure
  stateless tools (`compare`, `json`, `sql`, `timestamp`, `encoding`,
  and the `GET /api/tools` manifest) stay open; `analyze`, `rules*`,
  incidents/history/import/export are protected.
- `GET /api/tools` returns the manifest so an agent can self-serve without
  reading this README.
- Both surfaces (GUI + API) share the same tested logic under `src/lib/`.

## MCP server（原生 AI agent 通道）

Claude Code / Cursor / opencode /任何支援 MCP 嘅 agent 可以直接用呢六個工具 — 唔使
read OpenAPI,唔使 curl。`src/mcp/server.ts` 用 MCP SDK 包住 **同一套 shared
runners**(`src/lib/tools/runners.ts`,同 `/api/tools/*` 完全一樣嘅邏輯,零 drift):

| MCP tool | 對應 HTTP API | 功能 |
| --- | --- | --- |
| `analyze` | `POST /api/tools/analyze` | rule-engine log 分析(雙語輸出 + opt-in AI fallback) |
| `compare` | `POST /api/tools/compare` | before/after log 對比 + regression verdict |
| `json` | `POST /api/tools/json` | format / validate / minify / search |
| `sql` | `POST /api/tools/sql` | format / safety / analyze(text-only,唔會執行) |
| `timestamp` | `POST /api/tools/timestamp` | Unix / ISO / UTC / timezone 換算 |
| `encoding` | `POST /api/tools/encoding` | Base64 / URL encode-decode |

**執行:**

```bash
npm run mcp        # stdio MCP server(內部:tsx src/mcp/server.ts)
```

啟動時會讀取專案根目錄嘅 `.env`(同 web server 一樣嘅 PST_* 設定會生效,包括
`PST_AI_FALLBACK`),並共用同一個 `data/app.db`(WAL 模式,web server 同 MCP 可以
同時行) — 所以 custom rules、incident dossier、AI fallback cache 同 API 完全一致。
回應格式係 `{ ok, data }` / `{ ok, error: { code, message } }`,同 HTTP API 相同。

**接駁 Claude Code**(專案根目錄 `.mcp.json`):

```json
{
  "mcpServers": {
    "pst-toolbox": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/absolute/path/to/production-support-toolbox"
    }
  }
}
```

**接駁 Cursor**(`.cursor/mcp.json`):同上一個結構。

**接駁 opencode**:

```json
{
  "mcp": {
    "pst-toolbox": {
      "type": "local",
      "command": ["npm", "run", "mcp"],
      "enabled": true
    }
  }
}
```

注意:用 stdio config 時 `cwd` 必須指向 toolbox 專案根目錄(佢需要讀 `.env` 同
`data/app.db`)。MCP 只提供六個 stateless 工具;data endpoints(incidents/history/
rules/alerts)保持 HTTP-only(見 Agent API)。

## Scoped custom rules (teach the engine your system)

The 27 built-in rules cover generic failure patterns. Your systems and
company have their own signatures (internal error codes, batch names,
gateway messages) — register them once and every future `analyze` recognises
them, scoped so each system keeps its own namespace:

```bash
# Register a rule that only applies to PaymentBatch logs
curl -X POST http://localhost:3000/api/tools/rules \
  -H "Content-Type: application/json" \
  -d '{"name":"pay-step44-timeout","scope":{"type":"components","values":["PaymentBatch"]},"patterns":["STEP44.*timeout"],"severity":"High","rootCauses":["PAY gateway timeout at STEP44"],"investigation":["Check gateway health"]}'

# List rules (filter by scope / preview which apply to a system)
curl "http://localhost:3000/api/tools/rules?scope=components&system=PaymentBatch"

# Update / delete
curl -X PUT http://localhost:3000/api/tools/rules/1 -H "Content-Type: application/json" -d '{"severity":"Critical"}'
curl -X DELETE http://localhost:3000/api/tools/rules/1
```

- **Scope** = `global` | `systems` (match the `system` hint) | `components`
  (match component names detected in the log) — so rules for one system never
  fire on another's logs.
- Patterns are validated at registration with **three layers**:
  1. **Syntax** — invalid regex → 400.
  2. **Static ReDoS screening** — `(a+)+`-style nested quantifiers, quantified
     alternations whose branches share a first character, and
     backreferences (`\1`, `\k<name>`) are rejected with an actionable
     message. Bounded constructs stay compatible (e.g. `\d{4}-\d{2}-\d{2}`,
     `(\d{1,3}\.){3}`, `(GET|POST|PUT)`).
  3. **Time-bounded torture test** — every pattern (registration, update AND
     import) runs inside a worker thread against a set of adversarial inputs
     with a hard budget; any pattern that does not finish is rejected, so a
     stored pattern is empirically proven not to hang an analysis request.
     Runtime pattern failures are also caught by the engine (the rule is
     skipped and reported via `skippedRules`, never a crash).
- Caps: ≤20 patterns/rule, ≤300 chars/pattern, ≤200 active rules total
  (`PST_MAX_CUSTOM_RULES` override), ≤500 rules/import bundle.
- Custom rules are merged into `/api/tools/analyze` (and its `summary`);
  matched custom rules are listed in `appliedCustomRules` and prevent the
  Unknown-Error triage. Rules can be exported/imported between machines via
  `GET /api/tools/rules?export=json` (per-deployment storage — each company
  keeps its own namespace).

## Alerts & notifications (v1)

Alert rules react to **saved analyses** (the explicit `Save Analysis` moment —
never automatic runs) and fire **locally + deterministically**:

- **Condition** — `minSeverity` (≥) + optional `errorTypes` / `systems` /
  `tools` filters (default tool: `log-analyzer`). Matching uses the same
  severity order as the rule engine; error types come from the stored
  analysis snapshot (rules or AI-fallback output), never from re-running AI.
- **Delivery** — every firing is **always recorded** as a local notification
  (visible under **Alerts** → 通知記錄), so the concept works with a rule and
  zero other config. Webhook delivery is **async and decoupled**:
  `Save Analysis` → the rule matches → the worker **enqueues** the webhook
  job in the same request (notification starts `status=pending`) → the save
  response returns **immediately** (it never blocks on network) → a background
  worker (started from `instrumentation.ts`, poll every
  `PST_ALERT_WORKER_INTERVAL_MS`) delivers the generic `POST` JSON
  (Teams / Slack / anything):
  `{ event, firedAt, rule, entry:{id,tool,system,summary,severity}, analysis:{errorTypes} }`.
  The payload never contains the raw log. Transient failures retry with
  **exponential backoff** (1m, 2m, 4m… cap 1h, up to `PST_ALERT_MAX_ATTEMPTS`)
  and the notification only settles to `sent` / `failed` at the end; a broken
  webhook can **never break the save**. Jobs persist in SQLite, so anything
  queued while the server was off is delivered when it is next started.
- **Cooldown** — per (rule, signal) minutes; the same system/severity/error
  signature is suppressed inside the window (spam guard).
- **Test** — `POST /api/alerts/[id]/test` (or the GUI `Send Test` button)
  delivers a test payload immediately and reports `{ delivered, detail }`.
- **Scoping** — evaluation hooks the history save route only: imports and
  backfills deliberately do NOT fire alerts (no bulk-restore spam).
- **Off switch** — `PST_ALERTS_ENABLED=off` disables evaluation globally.
- Webhook validation rejects non-`http(s)` URLs and embedded credentials;
  note this is a local tool, so webhooks may reach your LAN by design.

```bash
# Alert when any High+ saved analysis mentions SQL Exception on ledger
curl -X POST http://localhost:3000/api/alerts \
  -H "Content-Type: application/json" \
  -d '{"name":"ledger sql high","condition":{"minSeverity":"High","errorTypes":["SQL Exception"],"systems":["ledger"]},"channels":[{"type":"webhook","url":"https://hooks.example.com/team"}],"cooldownMinutes":60}'

# Verify delivery instantly
curl -X POST http://localhost:3000/api/alerts/1/test

# See what fired (always recorded, fails included)
curl http://localhost:3000/api/notifications
```

## Project structure

```text
production-support-toolbox/
  src/
    app/                     # Next.js app router + API routes
      api/
        tools/               # Agent API: analyze, compare, json, sql, timestamp, encoding
        tools/rules/         # custom rule registry (+ [id], import)
        incidents/           # GET/POST + [id] GET/PUT/DELETE
        history/             # GET/POST + [id] GET/DELETE
        export/ import/      # backup bundle / import
        dashboard/           # aggregated report (GET)
        alerts/              # alert rules (+ [id], [id]/test)
        notifications/       # alert-firing log (GET/DELETE)
        openapi.json/        # OpenAPI 3.1 document (GET)
    components/              # shared UI primitives, AppShell (nav/theme), SaveButton
    features/
      log-analyzer/          # Log Analyzer UI
      log-comparison/        # Log Comparison UI
      json/                  # JSON Toolbox UI
      sql/                   # SQL Toolbox UI
      timestamp/             # Timestamp Converter UI
      encoding/              # Base64 / URL UI
      incidents/             # Incident Notes UI
      history/               # Support History UI
      dashboard/             # Dashboard UI (trends/aggregation)
      rules/                 # Custom Rules GUI (human-facing rule manager)
      alerts/                # Alerts UI (rules + notification log)
    lib/
      database/              # SQLite access + incident/history/alert repositories + dashboard aggregation
      log-parser/            # field extraction from log text
      rules/                 # rule catalogue + engine
      log-comparison/        # before/after diff logic
      json/                  # format/validate/minify/search
      sql/                   # formatter, safety checker, analyzer
      timestamp/             # Unix/ISO/UTC/timezone conversion (Intl only)
      encoding/              # base64 / URL encode/decode
      tools/                 # SHARED tool runners — the single implementation behind BOTH /api/tools/* and MCP
      sensitive/             # sensitive-data keyword detection
      llm/                   # shared server helpers (redact, dossier, log input validation)
      errors.ts              # shared ToolError
    mcp/                     # MCP stdio server (Claude Code / Cursor / opencode) over the shared runners
    types/                   # shared TypeScript types
  data/                      # SQLite database (created on first run, gitignored)
```

Business logic lives in `src/lib/*` and is tested independently of React —
components stay thin.

## SQLite database location

- **File:** `data/app.db` (next to the project root), created automatically
  on first use — no server, no installation.
- WAL mode is enabled for reliable local writes.
- Override the location with the environment variable `PST_DATA_DIR`
  (used by tests and advanced setups).
- The tables are `incidents`, `history`, `custom_rules`, `alert_rules`,
  `notifications` and `alert_firings` (per-rule cooldown keys), plus
  `analysis_cache` (a disposable AI-fallback cache that is intentionally NOT
  backed up); the schema is created automatically at startup
  (`src/lib/database/db.ts`). Dashboard aggregation reads the same tables
  (`src/lib/database/dashboard.ts`, JSON1 straight in SQLite — no full
  payload loads into JS).
- **Backups:** `<data dir>/backups/backups-YYYY-MM-DD.json`, written at most
  once per day (same canonical serializer as the manual export), atomically
  replaced (temp file + rename, so an interrupted write never corrupts the
  last good backup), pruned to `PST_BACKUP_RETENTION` days (default 30).

## Development notes

- `@/` path alias maps to `src/` (configured in `tsconfig.json` and
  `vitest.config.ts`).
- `better-sqlite3` is a native module and is excluded from the bundler via
  `serverExternalPackages` in `next.config.ts`; API routes run on the Node
  runtime and are marked `force-dynamic`.
- **Accessing from another machine on the LAN**: the server binds
  `127.0.0.1` by default. Use `PST_REMOTE_ACCESS=true npm run dev:remote`
  (requires `PST_API_TOKEN*`, see "Remote mode & API access control").
  Next.js 16 blocks cross-origin dev resources by default; `next.config.ts`
  allows hosts on the `192.168.1.*` subnet, and you can override the list
  without touching code:
  ```bash
  PST_ALLOWED_DEV_ORIGINS="192.168.*.*,10.0.*.*" npm run dev:remote
  ```
  (wildcards match one dot-separated label; `**` matches the rest).
- Dark mode uses a class on `<html>` (`pst-theme` in `localStorage`,
  default follows the OS preference).
- Deep links: the sidebar selection is mirrored in the URL hash
  (e.g. `http://localhost:3000/#/log-analyzer`).