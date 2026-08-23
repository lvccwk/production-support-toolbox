import type {
  AlertChannel,
  AlertCondition,
  AlertRule,
  AlertRuleInput,
  HistoryEntry,
  Notification,
  NotificationChannel,
  NotificationStatus,
  Severity,
} from "@/types";
import { SEVERITY_ORDER } from "@/types";
import { ToolError } from "@/lib/errors";
import { getDb } from "./db";
import { parseHistoryAnalysis } from "./export";

/**
 * Alerts & notifications (v1): user-configured rules that react to SAVED
 * analyses (the explicit, deterministic moment — never automatic runs).
 *
 * Design rules:
 *   - evaluation is 100% local and deterministic (same severity/error-type
 *     logic as the rule engine, no AI), firing only inside the history save
 *     route — imports/backfills deliberately do NOT fire alerts.
 *   - every firing is ALWAYS recorded as a local notification row (so the
 *     concept works with zero configuration beyond a rule).
 *   - webhook delivery is ASYNC and decoupled from the save: `evaluateAlerts`
 *     only enqueues jobs (and writes "pending" notifications) in the same
 *     request, so the Save Analysis response never blocks on the network.
 *     A background worker (`processAlertJobs`, started from
 *     instrumentation.ts) delivers with exponential-backoff retries and
 *     finally marks the notification sent / failed.
 *   - `evaluateAlerts` / `processAlertJobs` NEVER throw: a failing or slow
 *     webhook can never fail the save it was triggered by.
 *   - per (rule, signal) cooldown suppresses repeat spam from the same
 *     system/severity/error-type signature.
 */

export const ALERT_LIMITS = {
  nameChars: 120,
  toolsPerRule: 8,
  toolChars: 40,
  errorTypesPerRule: 12,
  errorTypeChars: 60,
  systemsPerRule: 12,
  systemChars: 60,
  webhookUrlsPerRule: 3,
  webhookUrlChars: 2048,
  cooldownMaxMinutes: 7 * 24 * 60, // 10080 = one week
  messageChars: 500,
  detailChars: 300,
  titleChars: 160,
} as const;

/** Total alert-rules cap (active, like custom rules — env overridable). */
export function maxAlertRules(env: NodeJS.ProcessEnv = process.env): number {
  const fromEnv = Number(env.PST_MAX_ALERT_RULES);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : 100;
}

export function alertsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PST_ALERTS_ENABLED !== "false";
}

export function alertWebhookTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const fromEnv = Number(env.PST_ALERT_WEBHOOK_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 5000;
}

/** Delivery attempts before a webhook job is marked permanently failed. */
export function alertMaxAttempts(env: NodeJS.ProcessEnv = process.env): number {
  const fromEnv = Number(env.PST_ALERT_MAX_ATTEMPTS);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : 3;
}

/** Background worker poll interval. */
export function alertWorkerIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const fromEnv = Number(env.PST_ALERT_WORKER_INTERVAL_MS);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : 30_000;
}

const SEVERITIES: Severity[] = ["Critical", "High", "Medium", "Low", "Informational"];

function strArray(
  value: unknown,
  field: string,
  maxItems: number,
  maxChars: number,
): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ToolError(`${field} must be an array.`);
  if (value.length > maxItems) throw new ToolError(`${field} exceeds max ${maxItems} items.`);
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") throw new ToolError(`${field} entries must be text.`);
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (trimmed.length > maxChars) throw new ToolError(`${field} entry exceeds max ${maxChars} chars.`);
    out.push(trimmed);
  }
  return out;
}

/** A webhook URL must be http(s), credential-free, and reasonably short. */
function validateWebhookUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolError("Webhook URL is required.");
  }
  const url = value.trim();
  if (url.length > ALERT_LIMITS.webhookUrlChars) {
    throw new ToolError(`Webhook URL is too long (max ${ALERT_LIMITS.webhookUrlChars} chars).`);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ToolError("Webhook URL is not a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ToolError("Webhook URL must start with http:// or https://.");
  }
  if (parsed.username || parsed.password) {
    throw new ToolError("Webhook URL must not contain embedded credentials.");
  }
  return url;
}

export function validateAlertRuleInput(raw: Partial<AlertRuleInput>): AlertRuleInput {
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, ALERT_LIMITS.nameChars) : "";
  if (!name) throw new ToolError("Alert rule name is required.");

  const minSeverity = raw.condition?.minSeverity;
  if (typeof minSeverity !== "string" || !SEVERITIES.includes(minSeverity as Severity)) {
    throw new ToolError("Invalid minSeverity.");
  }

  const tools = strArray(
    raw.condition?.tools,
    "condition.tools",
    ALERT_LIMITS.toolsPerRule,
    ALERT_LIMITS.toolChars,
  );
  const errorTypes = strArray(
    raw.condition?.errorTypes,
    "condition.errorTypes",
    ALERT_LIMITS.errorTypesPerRule,
    ALERT_LIMITS.errorTypeChars,
  );
  const systems = strArray(
    raw.condition?.systems,
    "condition.systems",
    ALERT_LIMITS.systemsPerRule,
    ALERT_LIMITS.systemChars,
  );

  const condition: AlertCondition = {
    minSeverity: minSeverity as Severity,
    tools: tools.length > 0 ? tools : ["log-analyzer"],
    errorTypes,
    systems,
  };

  const rawChannels = Array.isArray(raw.channels) ? raw.channels : [];
  if (rawChannels.length > ALERT_LIMITS.webhookUrlsPerRule) {
    throw new ToolError(
      `Too many webhook URLs (max ${ALERT_LIMITS.webhookUrlsPerRule} per rule).`,
    );
  }
  const channels: AlertChannel[] = [];
  const seen = new Set<string>();
  for (const entry of rawChannels) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ToolError("Invalid channel entry.");
    }
    const channel = entry as Partial<AlertChannel>;
    if (channel.type !== "webhook") throw new ToolError("Unsupported channel type.");
    const url = validateWebhookUrl(channel.url);
    if (seen.has(url)) continue;
    seen.add(url);
    channels.push({ type: "webhook", url });
  }

  let cooldownMinutes = 60;
  if (raw.cooldownMinutes !== undefined && raw.cooldownMinutes !== null) {
    const candidate = Number(raw.cooldownMinutes);
    if (!Number.isInteger(candidate) || candidate < 0 || candidate > ALERT_LIMITS.cooldownMaxMinutes) {
      throw new ToolError(
        `cooldownMinutes must be an integer 0..${ALERT_LIMITS.cooldownMaxMinutes}.`,
      );
    }
    cooldownMinutes = candidate;
  }

  return {
    name,
    condition,
    channels,
    cooldownMinutes,
    active: raw.active !== false,
  };
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export interface AlertRuleRow {
  id: number;
  name: string;
  active: number;
  condition: string;
  channels: string;
  cooldown_minutes: number;
  created_at: string;
  updated_at: string;
}

function parseJson(value: string, fallback: unknown): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toAlertRule(row: AlertRuleRow): AlertRule {
  const condition = parseJson(row.condition, null) as Partial<AlertCondition> | null;
  const channels = parseJson(row.channels, []) as AlertChannel[];
  return {
    id: row.id,
    name: row.name,
    active: row.active !== 0,
    condition: {
      minSeverity:
        condition && typeof condition.minSeverity === "string"
          ? (condition.minSeverity as Severity)
          : "High",
      tools: Array.isArray(condition?.tools) ? condition.tools : ["log-analyzer"],
      errorTypes: Array.isArray(condition?.errorTypes) ? condition.errorTypes : [],
      systems: Array.isArray(condition?.systems) ? condition.systems : [],
    },
    channels: Array.isArray(channels)
      ? channels.filter((c) => c && typeof c === "object" && c.type === "webhook")
      : [],
    cooldownMinutes: row.cooldown_minutes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listAlertRules(activeOnly = false): AlertRule[] {
  const db = getDb();
  const sql = activeOnly
    ? "SELECT * FROM alert_rules WHERE active = 1 ORDER BY updated_at DESC, id DESC"
    : "SELECT * FROM alert_rules ORDER BY updated_at DESC, id DESC";
  const rows = db.prepare(sql).all() as AlertRuleRow[];
  return rows.map(toAlertRule);
}

export function getAlertRule(id: number): AlertRule | null {
  const row = getDb().prepare("SELECT * FROM alert_rules WHERE id = ?").get(id) as
    | AlertRuleRow
    | undefined;
  return row ? toAlertRule(row) : null;
}

function insertAlertRuleRow(raw: AlertRuleInput): number {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO alert_rules (name, active, condition, channels, cooldown_minutes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      raw.name,
      raw.active === false ? 0 : 1,
      JSON.stringify(raw.condition),
      JSON.stringify(raw.channels ?? []),
      raw.cooldownMinutes ?? 60,
      now,
      now,
    );
  return Number(result.lastInsertRowid);
}

export function createAlertRule(raw: Partial<AlertRuleInput>): AlertRule {
  const input = validateAlertRuleInput(raw);
  const db = getDb();
  const id = db.transaction((): number => {
    const activeCount = db
      .prepare("SELECT COUNT(*) AS n FROM alert_rules WHERE active = 1")
      .get() as { n: number };
    if (input.active && activeCount.n >= maxAlertRules()) {
      throw new ToolError(`Alert rules limit reached (${maxAlertRules()}).`);
    }
    return insertAlertRuleRow(input);
  }).immediate();
  return getAlertRule(id)!;
}

export function updateAlertRule(id: number, raw: Partial<AlertRuleInput>): AlertRule | null {
  const db = getDb();
  return db
    .transaction(() => {
      const existing = getAlertRule(id);
      if (!existing) return null;
      const input = validateAlertRuleInput({ ...existing, ...raw });
      if (!existing.active && input.active) {
        const activeCount = db
          .prepare("SELECT COUNT(*) AS n FROM alert_rules WHERE active = 1")
          .get() as { n: number };
        if (activeCount.n >= maxAlertRules()) {
          throw new ToolError(`Alert rules limit reached (${maxAlertRules()}).`);
        }
      }
      db.prepare(
        `UPDATE alert_rules SET
           name = ?, active = ?, condition = ?, channels = ?, cooldown_minutes = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        input.name,
        input.active === false ? 0 : 1,
        JSON.stringify(input.condition),
        JSON.stringify(input.channels ?? []),
        input.cooldownMinutes ?? 60,
        new Date().toISOString(),
        id,
      );
      return getAlertRule(id);
    })
    .immediate();
}

export function deleteAlertRule(id: number): boolean {
  const db = getDb();
  const result = db.transaction(() => {
    const deleted = db.prepare("DELETE FROM alert_rules WHERE id = ?").run(id);
    if (deleted.changes > 0) {
      db.prepare("DELETE FROM alert_firings WHERE rule_id = ?").run(id);
    }
    return deleted.changes > 0;
  }).immediate();
  return result;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface NotificationRow {
  id: number;
  created_at: string;
  rule_id: number | null;
  rule_name: string;
  level: string;
  title: string;
  message: string;
  channel: string;
  status: string;
  detail: string;
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    createdAt: row.created_at,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    level: (SEVERITIES as string[]).includes(row.level) ? (row.level as Severity) : "Informational",
    title: row.title,
    message: row.message,
    channel: (["webhook", "in-app", "test"] as const).includes(
      row.channel as NotificationChannel,
    )
      ? (row.channel as NotificationChannel)
      : "in-app",
    status: row.status === "failed" ? "failed" : row.status === "pending" ? "pending" : "sent",
    detail: row.detail,
  };
}

export function listNotifications(limit = 100): Notification[] {
  const rows = getDb()
    .prepare("SELECT * FROM notifications ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(limit) as NotificationRow[];
  return rows.map(toNotification);
}

export function clearNotifications(): number {
  const result = getDb().prepare("DELETE FROM notifications").run();
  return result.changes;
}

function insertNotification(input: {
  ruleId: number | null;
  ruleName: string;
  level: Severity;
  title: string;
  message: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  detail: string;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO notifications
       (created_at, rule_id, rule_name, level, title, message, channel, status, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      new Date().toISOString(),
      input.ruleId,
      input.ruleName,
      input.level,
      input.title.slice(0, ALERT_LIMITS.titleChars),
      input.message.slice(0, ALERT_LIMITS.messageChars),
      input.channel,
      input.status,
      input.detail.slice(0, ALERT_LIMITS.detailChars),
    );
  return Number(result.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// Firing logic (cooldown, matching, delivery)
// ---------------------------------------------------------------------------

function trim(value: string): string {
  return value.trim();
}

/** Does a saved analysis entry match the rule's condition? Pure + local. */
export function alertRuleMatches(
  rule: AlertRule,
  entry: Pick<HistoryEntry, "tool" | "system" | "severity">,
  errorTypes: string[],
): boolean {
  if (!rule.active) return false;
  const cond = rule.condition;
  if (!cond.tools.includes(entry.tool)) return false;
  if (entry.severity === null) return false;
  if (SEVERITY_ORDER[entry.severity] < SEVERITY_ORDER[cond.minSeverity]) return false;
  if (cond.systems.length > 0) {
    const system = trim(entry.system).toLowerCase();
    if (!system || !cond.systems.some((s) => s.toLowerCase() === system)) return false;
  }
  if (cond.errorTypes.length > 0) {
    const lower = errorTypes.map(trim).map((t) => t.toLowerCase());
    if (!lower.some((t) => cond.errorTypes.some((e) => e.toLowerCase() === t))) return false;
  }
  return true;
}

/** Stable anti-spam key for one signal (same system/severity/error types). */
export function alertFireKey(
  entry: Pick<HistoryEntry, "tool" | "system" | "severity">,
  errorTypes: string[],
): string {
  return [
    entry.tool,
    trim(entry.system),
    entry.severity ?? "",
    errorTypes.join("|"),
  ].join("::");
}

export interface DeliveryOutcome {
  ok: boolean;
  detail: string;
}

export interface WebhookOptions {
  timeoutMs?: number;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

/** Deliver one webhook POST. NEVER throws — failures become { ok: false }. */
export async function deliverWebhook(
  url: string,
  payload: unknown,
  opts: WebhookOptions = {},
): Promise<DeliveryOutcome> {
  const timeoutMs = opts.timeoutMs ?? alertWebhookTimeoutMs();
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Drain so the socket is reusable; ignore the body contents entirely.
    await response.text().catch(() => undefined);
    const ok = response.ok || (response.status >= 200 && response.status < 300);
    return {
      ok,
      detail: ok ? `HTTP ${response.status}` : `REJECTED HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error && error.name === "TimeoutError"
        ? `timeout after ${timeoutMs}ms`
        : `error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function recordFiring(ruleId: number, fireKey: string, nowIso: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO alert_firings (rule_id, fire_key, fired_at) VALUES (?, ?, ?)
     ON CONFLICT(rule_id, fire_key) DO UPDATE SET fired_at = excluded.fired_at`,
  ).run(ruleId, fireKey, nowIso);
}

function pruneOldFirings(nowIso: string, olderThanDays = 90): void {
  const cutoff = new Date(new Date(nowIso).getTime() - olderThanDays * 24 * 60 * 60 * 1000);
  getDb().prepare("DELETE FROM alert_firings WHERE fired_at < ?").run(cutoff.toISOString());
}

function webhookPayload(
  kind: "saved" | "test",
  rule: AlertRule,
  entry: HistoryEntry | null,
  errorTypes: string[],
  firedAt: string,
): Record<string, unknown> {
  return {
    event: kind === "saved" ? "history.saved" : "alert.test",
    firedAt,
    rule: {
      id: rule.id,
      name: rule.name,
      minSeverity: rule.condition.minSeverity,
      cooldownMinutes: rule.cooldownMinutes,
    },
    entry: entry
      ? {
          id: entry.id,
          createdAt: entry.createdAt,
          tool: entry.tool,
          system: entry.system,
          summary: entry.summary,
          severity: entry.severity,
        }
      : null,
    analysis: { errorTypes },
  };
}

export interface EvaluateOptions {
  /** Test seam for deterministic time. */
  now?: string;
  fetchImpl?: typeof fetch;
}

export interface AlertJobRow {
  id: number;
  notification_id: number;
  rule_id: number | null;
  rule_name: string;
  webhook_url: string;
  payload: string;
  attempts: number;
  max_attempts: number;
  status: string; // pending | failed (terminal)
  next_attempt_at: string;
  last_error: string;
  created_at: string;
  updated_at: string;
}

/** Insert one webhook job (delivery happens later in the background worker). */
function enqueueWebhookJob(input: {
  notificationId: number;
  ruleId: number | null;
  ruleName: string;
  webhookUrl: string;
  payload: Record<string, unknown>;
  nowIso: string;
  maxAttempts: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO alert_jobs
       (notification_id, rule_id, rule_name, webhook_url, payload, attempts,
        max_attempts, status, next_attempt_at, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, 'pending', ?, '', ?, ?)`,
    )
    .run(
      input.notificationId,
      input.ruleId,
      input.ruleName,
      input.webhookUrl,
      JSON.stringify(input.payload),
      input.maxAttempts,
      input.nowIso,
      input.nowIso,
      input.nowIso,
    );
}

/**
 * Evaluate all alert rules against one freshly-saved history entry and
 * enqueue the matches. In-app notifications are recorded immediately; webhook
 * notifications start as "pending" and are delivered asynchronously by
 * `processAlertJobs`. NEVER throws — a broken webhook can never break the
 * save. Imported/backfilled entries do NOT go through this path.
 */
export async function evaluateAlerts(
  entry: HistoryEntry,
  opts: EvaluateOptions = {},
): Promise<number> {
  try {
    if (!alertsEnabled()) return 0;
    const nowIso = opts.now ?? new Date().toISOString();
    const rules = listAlertRules(true);
    if (rules.length === 0) return 0;

    // Parse the entry's analysis snapshot once (rules or ai-fallback shape).
    const parsed = parseHistoryAnalysis(entry);
    const errorTypes = parsed ? parsed.errorTypes : [];

    let fired = 0;
    for (const rule of rules) {
      if (!alertRuleMatches(rule, entry, errorTypes)) continue;
      const key = alertFireKey(entry, errorTypes);
      const firedRow = getDb()
        .prepare("SELECT fired_at FROM alert_firings WHERE rule_id = ? AND fire_key = ?")
        .get(rule.id, key) as { fired_at: string } | undefined;
      if (rule.cooldownMinutes > 0 && firedRow) {
        const elapsedMs = new Date(nowIso).getTime() - new Date(firedRow.fired_at).getTime();
        if (Number.isFinite(elapsedMs) && elapsedMs < rule.cooldownMinutes * 60_000) {
          continue; // still in cooldown for this signal
        }
      }
      recordFiring(rule.id, key, nowIso);
      fired += 1;

      const level = entry.severity ?? rule.condition.minSeverity;
      const message = [
        entry.summary,
        entry.system ? `[${entry.system}]` : "",
        errorTypes.length > 0 ? `— ${errorTypes.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" ");

      if (rule.channels.length === 0) {
        insertNotification({
          ruleId: rule.id,
          ruleName: rule.name,
          level,
          title: rule.name,
          message,
          channel: "in-app",
          status: "sent",
          detail: "in-app only (no webhook configured)",
        });
        continue;
      }
      for (const channel of rule.channels) {
        const notificationId = insertNotification({
          ruleId: rule.id,
          ruleName: rule.name,
          level,
          title: rule.name,
          message,
          channel: "webhook",
          status: "pending",
          detail: `queued → ${channel.url.slice(0, 120)}`,
        });
        enqueueWebhookJob({
          notificationId,
          ruleId: rule.id,
          ruleName: rule.name,
          webhookUrl: channel.url,
          payload: webhookPayload("saved", rule, entry, errorTypes, nowIso),
          nowIso,
          maxAttempts: alertMaxAttempts(),
        });
      }
    }
    pruneOldFirings(nowIso);
    return fired;
  } catch {
    // Alerts must never break the save that triggered them.
    return 0;
  }
}

export interface ProcessJobsOptions {
  /** Test seam for deterministic time. */
  now?: string;
  fetchImpl?: typeof fetch;
  /** Max jobs per pass (keeps a tick short). */
  limit?: number;
}

/** In-flight claims so interval ticks and request-path drains never double-send. */
const processingJobs = new Set<number>();

/**
 * Background webhook worker: deliver all due jobs, record the outcome on the
 * linked notification (pending → sent / failed), retry transient failures
 * with exponential backoff, and give up after max_attempts. NEVER throws.
 * Returns how many jobs were processed this pass. Jobs persist in SQLite, so
 * anything queued while the server was down is sent once it is back up.
 */
export async function processAlertJobs(opts: ProcessJobsOptions = {}): Promise<number> {
  if (!alertsEnabled()) return 0;
  const nowIso = opts.now ?? new Date().toISOString();
  const limit = opts.limit ?? 20;
  const rows = getDb()
    .prepare(
      `SELECT * FROM alert_jobs
       WHERE status = 'pending' AND next_attempt_at <= ?
       ORDER BY next_attempt_at ASC, id ASC
       LIMIT ?`,
    )
    .all(nowIso, limit) as AlertJobRow[];

  let processed = 0;
  for (const row of rows) {
    if (processingJobs.has(row.id)) continue;
    processingJobs.add(row.id);
    try {
      const outcome = await deliverWebhook(
        row.webhook_url,
        parseJson(row.payload, null),
        { fetchImpl: opts.fetchImpl },
      );
      const attempts = row.attempts + 1;
      const db = getDb();
      if (outcome.ok) {
        db.prepare("UPDATE notifications SET status = 'sent', detail = ? WHERE id = ?").run(
          `${row.webhook_url.slice(0, 120)} — ${outcome.detail}`,
          row.notification_id,
        );
        db.prepare("DELETE FROM alert_jobs WHERE id = ?").run(row.id);
      } else if (attempts >= row.max_attempts) {
        db.prepare("UPDATE notifications SET status = 'failed', detail = ? WHERE id = ?").run(
          `${row.webhook_url.slice(0, 120)} — ${outcome.detail}（${attempts} 次嘗試後放棄）`,
          row.notification_id,
        );
        db.prepare(
          `UPDATE alert_jobs SET status = 'failed', attempts = ?, last_error = ?, updated_at = ? WHERE id = ?`,
        ).run(attempts, outcome.detail, nowIso, row.id);
      } else {
        // Transient failure: retry later with exponential backoff (1m, 2m, 4m… capped at 1h).
        const backoffMs = Math.min(60 * 60_000, 60_000 * 2 ** (attempts - 1));
        const nextAt = new Date(new Date(nowIso).getTime() + backoffMs).toISOString();
        db.prepare(
          `UPDATE alert_jobs SET attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
           WHERE id = ? AND status = 'pending'`,
        ).run(attempts, nextAt, outcome.detail, nowIso, row.id);
      }
      processed += 1;
    } catch {
      // deliverWebhook never throws on fetch errors; this guards anything else.
    } finally {
      processingJobs.delete(row.id);
    }
  }

  // Housekeeping: drop terminal jobs older than 90 days (notifications keep the audit).
  const cutoff = new Date(new Date(nowIso).getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  getDb()
    .prepare("DELETE FROM alert_jobs WHERE status IN ('sent', 'failed') AND updated_at < ?")
    .run(cutoff);
  return processed;
}

const workerGlobal = globalThis as { __pstAlertWorkerStarted?: boolean };

/**
 * Start the in-process background worker (called once from Next.js
 * instrumentation). Guarded so dev-server reloads never spawn a second
 * interval. Timers are unref'd so they never keep the process alive on their
 * own.
 */
export function startAlertWorker(intervalMs?: number): void {
  if (workerGlobal.__pstAlertWorkerStarted) return;
  workerGlobal.__pstAlertWorkerStarted = true;
  const every = intervalMs ?? alertWorkerIntervalMs();
  const tick = (): void => {
    void processAlertJobs().catch(() => undefined);
  };
  const timer = setInterval(tick, every);
  timer.unref?.();
  const first = setTimeout(tick, 1_000);
  first.unref?.();
}

/**
 * Deliver a TEST payload for one rule so users can verify their webhook
 * endpoint without waiting for a real match. Records a "test" notification.
 * NEVER throws (failures come back in the result).
 */
export async function sendTestAlert(
  ruleId: number,
  opts: EvaluateOptions = {},
): Promise<{ delivered: boolean; detail: string; notificationId: number | null }> {
  const rule = getAlertRule(ruleId);
  if (!rule) throw new ToolError("Alert rule not found.");
  const nowIso = opts.now ?? new Date().toISOString();

  if (rule.channels.length === 0) {
    const id = insertNotification({
      ruleId: rule.id,
      ruleName: rule.name,
      level: rule.condition.minSeverity,
      title: `${rule.name} (test)`,
      message: "TEST alert — no webhook configured on this rule.",
      channel: "test",
      status: "sent",
      detail: "in-app only",
    });
    return { delivered: true, detail: "in-app only", notificationId: id };
  }

  let first: DeliveryOutcome = { ok: false, detail: "no channel" };
  for (const channel of rule.channels) {
    first = await deliverWebhook(
      channel.url,
      webhookPayload("test", rule, null, [], nowIso),
      { fetchImpl: opts.fetchImpl },
    );
    const id = insertNotification({
      ruleId: rule.id,
      ruleName: rule.name,
      level: rule.condition.minSeverity,
      title: `${rule.name} (test)`,
      message: "TEST alert — webhook delivery check",
      channel: "test",
      status: first.ok ? "sent" : "failed",
      detail: `${channel.url.slice(0, 120)} — ${first.detail}`,
    });
    return { delivered: first.ok, detail: first.detail, notificationId: id };
  }
  return { delivered: first.ok, detail: first.detail, notificationId: null };
}