# Production Support Toolbox

A **local-first, agent-first** toolbox for developers and production support
engineers: analyse logs, inspect technical data, troubleshoot incidents and
perform common support tasks. Everything is **deterministic, local and
free** — no AI, no external services, nothing leaves the machine.

Built with **Next.js + TypeScript + Tailwind CSS + SQLite (`better-sqlite3`)**.
No database server, no Docker, no Redis, no Kubernetes, no external
authentication.

---

## Setup

```bash
npm install
npm run dev
```

Open http://localhost:3000. The application works fully offline after
installation.

## Testing

```bash
npm test          # vitest: unit tests for parsers, rules and tool logic
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
npm run start     # serve the production build
```

---

## Features (Version 1)

| Module | What it does |
| --- | --- |
| **Log Analyzer** | Paste application logs → severity, error types, possible root cause, affected components, immediate investigation, suggested fix, long-term improvement. Plus automatic extraction: timestamps, levels, components, `transactionId` / `requestId` / `traceId` / `correlationId` / `sessionId` / `userId`, exceptions, source files & line numbers, HTTP statuses, stack-trace detection. |
| **Log Comparison** | Paste two logs (Before / After) → new errors, missing errors, changed HTTP codes (`200 → 500`), changed exception types / components / error lines, regression verdict. |
| **JSON Toolbox** | Format, validate (with position), minify, search keys/values (e.g. `transactionId`, `status`, `errorCode`). Copy / clear everywhere. |
| **SQL Toolbox** | Text-only tools — never connects to a database. Format SQL, safety check (`DELETE`/`DROP`/`TRUNCATE`, `UPDATE`/`DELETE` without `WHERE` → WARNING), basic analysis (statement type, tables, WHERE, JOIN, ORDER BY, GROUP BY, LIMIT, `?` parameters). |
| **Timestamp Converter** | Unix seconds / milliseconds, ISO 8601, UTC and local wall clock in any IANA timezone (default `Asia/Hong_Kong`). Naive datetimes are interpreted in the selected timezone. |
| **HTTP Status Helper** | Searchable reference (~70 codes): meaning, common production causes, what to check. |
| **Base64 / URL** | UTF-8-safe Base64 encode/decode, URL encode (`hello world` → `hello%20world`) / decode. |
| **Cron Helper** | 5-field cron → human description (e.g. `0 8 * * *` → “Runs every day at 08:00.”) and the next 5 execution times. Supports `*`, lists, ranges, steps, month/weekday names, and the standard day-of-month/day-of-week rule. |
| **Incident Notes** | Incident records (title, system, environment, severity, detected time, symptoms, root cause, immediate fix, permanent fix, status, notes) stored in SQLite. Search, edit, delete. |
| **Support History** | Explicitly saved analyses (date, tool, system, summary, severity). Search, delete, **re-open** (the original inputs are restored in the tool). Nothing is stored automatically. |
| **Settings** | Backup / export / import (JSON bundle or per-table CSV) and a pointer to the Agent API. History CSV includes derived columns (`inputChars`, `inputPreview`, tool `detail`, `sensitive`) so you don't have to open every JSON payload. |

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
- `/api/tools/analyze` masks sensitive values (`password`, `token`,
  `authorization`, `api_key`, `client_secret`, …) in its response by default
  (`PST_REDACT=off` disables).
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
| `analyze` | rule-engine log analysis (severity, evidence, extracted fields, quantitative summary) + incident dossier — every text section in **English + Traditional Chinese** |
| `compare` | before/after log comparison + regression verdict |
| `json` | format / validate / minify / search |
| `sql` | format / safety check / basic analysis (text-only, never executes) |
| `timestamp` | Unix / ISO / UTC / local conversion in any IANA timezone |
| `http` | searchable HTTP status reference (meaning, causes, what-to-check) |
| `encoding` | Base64 / URL encode-decode |
| `cron` | describe 5-field cron + next 5 execution times |
| `rules` | scoped custom rule registry (see below) |

Data endpoints are also agent-callable: `/api/incidents` (CRUD),
`/api/history` (search with `?q=`), `/api/export`, `/api/import`.

- Every `/api/tools/*` call is **pure local + deterministic + free**: fixed
  JSON contract, `{ ok: true, data }` on success, `{ ok: false, error }` with
  a sensible message otherwise. No authentication, no telemetry, no AI.
- `GET /api/tools` returns the manifest so an agent can self-serve without
  reading this README.
- Both surfaces (GUI + API) share the same tested logic under `src/lib/`.

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
- Patterns are **regex-validated at registration** (invalid regex → 400) and
  capped (≤20 patterns/rule, ≤300 chars/pattern, ≤200 active rules total,
  `PST_MAX_CUSTOM_RULES` override).
- Custom rules are merged into `/api/tools/analyze` (and its `summary`);
  matched custom rules are listed in `appliedCustomRules` and prevent the
  Unknown-Error triage. Rules can be exported/imported between machines via
  `GET /api/tools/rules?export=json` (per-deployment storage — each company
  keeps its own namespace).

## Project structure

```text
production-support-toolbox/
  src/
    app/                     # Next.js app router + API routes
      api/
        tools/               # Agent API: analyze, compare, json, sql, timestamp, http, encoding, cron
        incidents/           # GET/POST + [id] GET/PUT/DELETE
        history/             # GET/POST + [id] GET/DELETE
        export/ import/      # backup bundle / import
    components/              # shared UI primitives, AppShell (nav/theme), SaveButton
    features/
      log-analyzer/          # Log Analyzer UI
      log-comparison/        # Log Comparison UI
      json/                  # JSON Toolbox UI
      sql/                   # SQL Toolbox UI
      timestamp/             # Timestamp Converter UI
      http/                  # HTTP Status Helper UI
      encoding/              # Base64 / URL UI
      cron/                  # Cron Helper UI
      incidents/             # Incident Notes UI
      history/               # Support History UI
    lib/
      database/              # SQLite access + incident/history repositories
      log-parser/            # field extraction from log text
      rules/                 # rule catalogue + engine
      log-comparison/        # before/after diff logic
      json/                  # format/validate/minify/search
      sql/                   # formatter, safety checker, analyzer
      timestamp/             # Unix/ISO/UTC/timezone conversion (Intl only)
      http/                  # HTTP status catalogue
      cron/                  # 5-field cron parser + next-run computation
      encoding/              # base64 / URL encode/decode
      sensitive/             # sensitive-data keyword detection
      llm/                   # shared server helpers (redact, dossier, log input validation)
      errors.ts              # shared ToolError
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
- The tables are `incidents` and `history`; the schema is created
  automatically at startup (`src/lib/database/db.ts`).

## Development notes

- `@/` path alias maps to `src/` (configured in `tsconfig.json` and
  `vitest.config.ts`).
- `better-sqlite3` is a native module and is excluded from the bundler via
  `serverExternalPackages` in `next.config.ts`; API routes run on the Node
  runtime and are marked `force-dynamic`.
- **Accessing from another machine on the LAN** (e.g.
  `http://192.168.1.231:3000`): Next.js 16 blocks cross-origin dev resources
  by default; `next.config.ts` already allows hosts on the `192.168.1.*`
  subnet. If your subnet differs (or changes), override the list without
  touching code:
  ```bash
  PST_ALLOWED_DEV_ORIGINS="192.168.*.*,10.0.*.*" npm run dev
  ```
  (wildcards match one dot-separated label; `**` matches the rest).
- Dark mode uses a class on `<html>` (`pst-theme` in `localStorage`,
  default follows the OS preference).
- Deep links: the sidebar selection is mirrored in the URL hash
  (e.g. `http://localhost:3000/#/log-analyzer`).