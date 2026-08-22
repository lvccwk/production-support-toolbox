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
}

/** Structured analysis produced by the rule engine. */
export interface LogAnalysis {
  severity: Severity;
  errorTypes: ErrorType[];
  affectedComponents: string[];
  rootCauses: string[];
  immediateInvestigation: string[];
  suggestedFixes: string[];
  longTermImprovements: string[];
  matchedRuleIds: string[];
  /** Evidence lines per matched rule (empty when a rule has no per-line matches). */
  matchedEvidence: Array<{ ruleId: string; ruleName: string; evidence: EvidenceLine[] }>;
  /** Present only when error-level log lines matched no rule. */
  unknownTriage: UnknownTriage | null;
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

export interface HttpStatusEntry {
  code: number;
  phrase: string;
  category: "1xx" | "2xx" | "3xx" | "4xx" | "5xx";
  meaning: string;
  commonCauses: string[];
  whatToCheck: string[];
}

export interface CronField {
  raw: string;
  /** Expanded set of matching values, or null when `*` (any). */
  values: number[] | null;
}

export interface CronDescription {
  expression: string;
  human: string;
  nextRuns: string[];
  /** Seconds since epoch (local interpretation). */
  nextRunsUnix: number[];
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
  /** Structured AI deep-analysis (null when the entry has none). */
  ai: AiAnalysis | null;
}

export interface HistoryInput {
  tool: string;
  system: string;
  summary: string;
  severity: Severity | null;
  payload: string;
  /** Optional structured AI analysis (Phase 3), stored and exported. */
  ai?: AiAnalysis | null;
}

/** Structured LLM deep-analysis (schema-validated before storage). */
export interface AiAnalysis {
  severity: Severity;
  errorTypes: string[];
  rootCause: string;
  /** Traditional Chinese version of rootCause (bilingual output). */
  rootCauseZh: string;
  /** 1-based line numbers referenced by the model. */
  evidenceLines: number[];
  nextSteps: string[];
  /** Traditional Chinese version of nextSteps. */
  nextStepsZh: string[];
  confidence: number;
  explanation: string;
  /** Traditional Chinese version of explanation (optional). */
  explanationZh?: string;
}
