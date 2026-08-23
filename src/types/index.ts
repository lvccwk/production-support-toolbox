/** Shared domain types for the Production Support Toolbox. */

export type Severity = "Critical" | "High" | "Medium" | "Low" | "Informational";

export type ErrorType =
  | "NullPointerException"
  | "SQL Exception"
  | "Timeout"
  | "Connection Failure"
  | "HTTP Error"
  | "Authentication Error"
  | "Validation Error"
  | "OutOfMemory"
  | "File Not Found"
  | "Connection Pool Exhausted"
  | "Thread Pool Exhausted"
  | "SSL/TLS Error"
  | "JSON Parse Error"
  | "Serialization Error"
  | "Disk Full"
  | "Permission Error"
  | "Slow Query"
  | "Rate Limit"
  | "Circuit Breaker"
  | "Messaging Error"
  | "Cache Error"
  | "DNS Error"
  | "Batch Job Failure"
  | "Configuration Error"
  | "Certificate Error"
  | "WebSocket Error"
  | "Encoding Error"
  | "Custom Error"
  | "Unknown Error";

export const SEVERITY_ORDER: Record<Severity, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
  Informational: 0,
};

export interface LogRule {
  id: string;
  name: string;
  errorType: ErrorType;
  baseSeverity: Severity;
  /**
   * Detection patterns (non-global regexes, case-insensitivity decided per
   * pattern). A rule matches when ANY log line matches ANY of its patterns;
   * the matching lines become the rule's evidence.
   */
  patterns: RegExp[];
  affectedComponents: string[];
  rootCauses: string[];
  investigation: string[];
  suggestedFixes: string[];
  longTermImprovements: string[];
}

/** A line of the analysed log that triggered a rule (evidence). */
export interface EvidenceLine {
  /** 1-based line number in the original log. */
  line: number;
  /** Trimmed line text. */
  text: string;
}

/** Structured unknown-error triage produced when no rule matched. */
export interface UnknownTriage {
  /** Language/framework hint derived from source file extensions. */
  languageHint: string | null;
  /** Direction hint from extracted HTTP statuses (4xx vs 5xx). */
  httpDirection: "client" | "server" | null;
  causes: string[];
  investigation: string[];
  /** Traditional Chinese versions (mirror causes/investigation). */
  causesZh?: string[];
  investigationZh?: string[];
}

/** Structured analysis produced by the rule engine. */
export interface LogAnalysis {
  severity: Severity;
  errorTypes: ErrorType[];
  affectedComponents: string[];
  rootCauses: string[];
  /** Traditional Chinese versions — mirrors rootCauses index-for-index. */
  rootCausesZh?: string[];
  immediateInvestigation: string[];
  /** Traditional Chinese versions — mirrors immediateInvestigation. */
  immediateInvestigationZh?: string[];
  suggestedFixes: string[];
  /** Traditional Chinese versions — mirrors suggestedFixes. */
  suggestedFixesZh?: string[];
  longTermImprovements: string[];
  /** Traditional Chinese versions — mirrors longTermImprovements. */
  longTermImprovementsZh?: string[];
  matchedRuleIds: string[];
  /** Evidence lines per matched rule (empty when a rule has no per-line matches). */
  matchedEvidence: Array<{ ruleId: string; ruleName: string; evidence: EvidenceLine[] }>;
  /** Present only when error-level log lines matched no rule. */
  unknownTriage: UnknownTriage | null;
  /**
   * Rules whose patterns failed at runtime (defense in depth: a pattern that
   * throws must never crash the request — the rule is skipped and reported).
   */
  skippedRules?: Array<{ ruleId: string; name: string; reason: string }>;
}

/** A class + line reference extracted from a stack frame, e.g. PaymentService.java:125 */
export interface SourceRef {
  file: string;
  line: number | null;
  symbol: string | null;
}

/** Fields extracted from raw log text (section 6 of the requirements). */
export interface ExtractedLogInfo {
  timestamps: string[];
  levels: string[];
  components: string[];
  identifiers: Record<string, string>;
  exceptions: string[];
  sources: SourceRef[];
  httpStatuses: number[];
  stackTrace: boolean;
}

export interface LogParseResult {
  analysis: LogAnalysis;
  info: ExtractedLogInfo;
}

export interface JsonSearchHit {
  path: string;
  value: unknown;
}

export interface JsonValidationResult {
  valid: boolean;
  error: string | null;
  position: number | null;
}

export type SqlStatementType =
  | "SELECT"
  | "INSERT"
  | "UPDATE"
  | "DELETE"
  | "CREATE"
  | "ALTER"
  | "DROP"
  | "TRUNCATE"
  | "UNKNOWN";

export interface SqlAnalysis {
  statementType: SqlStatementType;
  tables: string[];
  hasWhere: boolean;
  joins: string[];
  orderBy: string[];
  groupBy: string[];
  hasLimit: boolean;
  parameterCount: number;
}

export type SqlSafetySeverity = "critical" | "warning" | "info";

export interface SqlSafetyIssue {
  severity: SqlSafetySeverity;
  code: string;
  message: string;
  /** Exact offending statement text. */
  statement: string;
}

export interface SqlSafetyResult {
  issues: SqlSafetyIssue[];
  safe: boolean;
}

export type IncidentStatus =
  | "Investigating"
  | "Identified"
  | "Fixed"
  | "Monitoring"
  | "Closed";

export const INCIDENT_STATUSES: IncidentStatus[] = [
  "Investigating",
  "Identified",
  "Fixed",
  "Monitoring",
  "Closed",
];

export const INCIDENT_SEVERITIES: Severity[] = [
  "Critical",
  "High",
  "Medium",
  "Low",
  "Informational",
];

export interface Incident {
  id: number;
  title: string;
  system: string;
  environment: string;
  severity: Severity;
  detectedAt: string;
  symptoms: string;
  rootCause: string;
  immediateFix: string;
  permanentFix: string;
  status: IncidentStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentInput {
  title: string;
  system: string;
  environment: string;
  severity: Severity;
  detectedAt: string;
  symptoms: string;
  rootCause: string;
  immediateFix: string;
  permanentFix: string;
  status: IncidentStatus;
  notes: string;
}

export interface HistoryEntry {
  id: number;
  createdAt: string;
  tool: string;
  system: string;
  summary: string;
  severity: Severity | null;
  /** JSON payload used to re-open the saved analysis. */
  payload: string;
}

export interface HistoryInput {
  tool: string;
  system: string;
  summary: string;
  severity: Severity | null;
  payload: string;
}

/** Scope of a custom rule — which systems/components it applies to. */
export type RuleScopeType = "global" | "systems" | "components";

export interface RuleScope {
  type: RuleScopeType;
  /** System names (systems scope) or component names (components scope). */
  values: string[];
}

/** A user/agent-registered detection rule (stored in SQLite). */
export interface CustomRule {
  id: number;
  name: string;
  scope: RuleScope;
  patterns: string[];
  severity: Severity;
  affectedComponents: string[];
  rootCauses: string[];
  investigation: string[];
  suggestedFixes: string[];
  longTermImprovements: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomRuleInput {
  name: string;
  scope: RuleScope;
  patterns: string[];
  severity: Severity;
  affectedComponents?: string[];
  rootCauses?: string[];
  investigation?: string[];
  suggestedFixes?: string[];
  longTermImprovements?: string[];
  active?: boolean;
}

// ---------------------------------------------------------------------------
// Dashboard (aggregation over history + incidents)
// ---------------------------------------------------------------------------

export interface SeverityCount {
  severity: Severity;
  count: number;
}

export interface NameCount {
  name: string;
  count: number;
}

export interface DayBucket {
  /** Local date (YYYY-MM-DD) of the bucket. */
  day: string;
  total: number;
  /** Entries with severity High or Critical that day. */
  highPlus: number;
}

export interface DashboardSummary {
  generatedAt: string;
  history: {
    total: number;
    /** Filled for log-analyzer entries only (others have no analysis). */
    aiFallbackCount: number;
    bySeverity: SeverityCount[];
    byTool: NameCount[];
    bySystem: NameCount[];
    /** Error-type frequency across log-analyzer history (top N). */
    errorTypes: NameCount[];
    /** Daily buckets covering the last `days` days (oldest first). */
    trend: DayBucket[];
  };
  incidents: {
    total: number;
    open: number;
    byStatus: NameCount[];
  };
}

// ---------------------------------------------------------------------------
// Alerts / notifications
// ---------------------------------------------------------------------------

/** When an alert rule fires — which saved analyses it reacts to. */
export interface AlertCondition {
  /** Fire when the saved entry's severity is >= this. */
  minSeverity: Severity;
  /** Optional: fire only when at least one of these error types is present. */
  errorTypes: string[];
  /** Optional: fire only when the entry's system is in this list. */
  systems: string[];
  /** Optional: fire only for these tools (default: ["log-analyzer"]). */
  tools: string[];
}

/** Delivery target of an alert (v1: a single generic webhook). */
export interface AlertChannel {
  type: "webhook";
  url: string;
}

/** A user-configured alert rule (stored in SQLite). */
export interface AlertRule {
  id: number;
  name: string;
  active: boolean;
  condition: AlertCondition;
  channels: AlertChannel[];
  /** Per (rule, signal) cooldown in minutes — suppress repeat spam. */
  cooldownMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface AlertRuleInput {
  name: string;
  active?: boolean;
  condition: {
    minSeverity: Severity;
    errorTypes?: string[];
    systems?: string[];
    tools?: string[];
  };
  channels?: AlertChannel[];
  cooldownMinutes?: number;
}

export type NotificationStatus = "sent" | "failed" | "pending";
export type NotificationChannel = "webhook" | "in-app" | "test";

/** One fired alert — always recorded locally, webhook delivery optional. */
export interface Notification {
  id: number;
  createdAt: string;
  ruleId: number | null;
  ruleName: string;
  /** Entry severity at firing time. */
  level: Severity;
  title: string;
  message: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  /** Delivery detail (statusCode / error) — not user data. */
  detail: string;
}
