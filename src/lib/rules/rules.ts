import type { LogRule } from "@/types";

/**
 * Static rule catalogue for the rule-based log analysis engine (section 5).
 * Every rule is a pure predicate over the log text plus the guidance texts
 * shown to a production support engineer.
 */

export const RULES: LogRule[] = [
  {
    id: "null-pointer",
    name: "NullPointerException",
    errorType: "NullPointerException",
    baseSeverity: "High",
    detect: (text) => /\bNullPointerException\b/.test(text),
    affectedComponents: [],
    rootCauses: [
      "A null object reference was dereferenced.",
      "A database query may have returned no record.",
      "Missing request or input validation.",
      "An expected configuration or environment value may be absent.",
    ],
    investigation: [
      "Identify the exact class and line number from the stack trace.",
      "Check whether the input data is null or empty.",
      "Check whether a database query returned no record.",
      "Check request/input validation on the caller path.",
      "Check related logs just before the failure.",
    ],
    suggestedFixes: [
      "Add null validation before processing the payment record or request.",
      "Use Optional / null-safe access when retrieving values.",
      "Return a clear error instead of dereferencing a null value.",
    ],
    longTermImprovements: [
      "Add defensive validation and isolate invalid batch records so one failed record does not stop the whole batch.",
      "Log sanitised inputs to make the null source traceable.",
    ],
  },
  {
    id: "sql-error",
    name: "Database / SQL Error",
    errorType: "SQL Exception",
    baseSeverity: "High",
    detect: (text) =>
      /\b(SQLException|SQLSyntaxErrorException|SQLNonTransientException|SQLTransientException|SQLSTATE|DB2\s?error|ORA-\d+|deadlock|lock ?timeout|database ?(?:error|exception|down|unavailable)|cannot ?connect)/i.test(
        text,
      ) || /\bSQL\b/i.test(text),
    affectedComponents: ["Database"],
    rootCauses: [
      "Database temporarily unavailable.",
      "Lock contention or deadlock.",
      "Query timeout.",
      "Invalid SQL syntax.",
      "Missing table or column.",
    ],
    investigation: [
      "Check database availability and the connection pool.",
      "Review locking: look for deadlock or lock-timeout reports.",
      "Check query timeout thresholds for long-running queries.",
      "Review the failing SQL statement and object names.",
      "Check DB2/SQL error codes and message details.",
    ],
    suggestedFixes: [
      "Retry the operation once the database is confirmed available.",
      "Simplify or index the query to reduce lock time.",
      "Verify table and column names against the schema.",
      "Increase the statement timeout where appropriate.",
    ],
    longTermImprovements: [
      "Add retry logic with backoff for transient database errors.",
      "Route heavy analytical queries to a reporting replica.",
      "Add indexes on columns used in WHERE and JOIN clauses.",
    ],
  },
  {
    id: "timeout",
    name: "Timeout",
    errorType: "Timeout",
    baseSeverity: "High",
    detect: (text) =>
      /\b(timeout|timed ?out|read ?timeout|connect(?:ion)? ?timeout|TimeoutException|SocketTimeoutException)\b/i.test(
        text,
      ),
    affectedComponents: [],
    rootCauses: [
      "Slow network or DNS resolution.",
      "Downstream API dependency not responding in time.",
      "Slow or locked database query.",
      "Exhausted thread pool or connection pool.",
    ],
    investigation: [
      "Check network latency and connectivity between components.",
      "Check the downstream API and its upstream dependencies.",
      "Check long-running database queries.",
      "Check thread pool and connection pool utilisation.",
      "Check recent deployment or traffic spikes.",
    ],
    suggestedFixes: [
      "Increase the timeout or add retry with backoff where safe.",
      "Fix the underlying slow dependency or query.",
      "Release connections promptly to free the pool.",
    ],
    longTermImprovements: [
      "Add circuit breakers and bulkheads around external calls.",
      "Set SLOs and alert on timeout rates.",
    ],
  },
  {
    id: "connection-failure",
    name: "Connection Failure",
    errorType: "Connection Failure",
    baseSeverity: "High",
    detect: (text) =>
      /\b(connection refused|ECONNREFUSED|connect(?:ion)? (?:failed|failure|reset)|no route to host|unable to connect|cannot connect|could not connect)\b/i.test(
        text,
      ),
    affectedComponents: ["Database", "External API"],
    rootCauses: [
      "Database or service is down or unreachable.",
      "Network or firewall blocking the connection.",
      "Wrong host, port or endpoint configuration.",
      "All connections in the pool are already in use.",
    ],
    investigation: [
      "Check whether the target service is up.",
      "Test connectivity to the host and port.",
      "Check firewall, network and DNS.",
      "Check connection pool settings and current usage.",
      "Check recent deployment of either side of the connection.",
    ],
    suggestedFixes: [
      "Restart or restore the target service.",
      "Correct the host, port or credential configuration.",
      "Release idle connections and tune the pool size.",
    ],
    longTermImprovements: [
      "Add connection health checks and automatic reconnect.",
      "Monitor connectivity as a golden signal.",
    ],
  },
  {
    id: "http-error",
    name: "HTTP Error",
    errorType: "HTTP Error",
    baseSeverity: "Medium",
    detect: (text) => /(?:HTTP[/\s]+|status\s*[=:]\s*|statusCode\s*[=:]\s*)([4-5]\d\d)\b/i.test(text),
    affectedComponents: ["External API"],
    rootCauses: [
      "Backend returned an error status code (see HTTP status).",
      "Downstream API unavailable or rejecting the request.",
      "Client sent invalid input or missing authentication.",
    ],
    investigation: [
      "Identify the HTTP status code and the affected endpoint.",
      "Check the downstream API logs for the same request.",
      "Check the request payload validity.",
      "Check recent deployment of the called service.",
    ],
    suggestedFixes: [
      "Handle the status code explicitly with a clear error.",
      "Retry idempotent requests on transient 5xx responses.",
      "Fix the request payload or authentication.",
    ],
    longTermImprovements: [
      "Expose structured error codes so clients can handle failures.",
      "Add service-level status dashboards.",
    ],
  },
  {
    id: "authentication",
    name: "Authentication Error",
    errorType: "Authentication Error",
    baseSeverity: "Medium",
    detect: (text) =>
      /\b(401|unauthorized|authentication failed|authenticat(?:ion|e) error|invalid token|expired token|access denied|invalid credential|token expired)\b/i.test(
        text,
      ),
    affectedComponents: ["Authentication Server"],
    rootCauses: [
      "Token expired or invalid.",
      "Authentication server unavailable or rejecting the request.",
      "Wrong credentials.",
      "OAuth/OIDC configuration issue (issuer, audience, scope).",
    ],
    investigation: [
      "Check token expiry and issuance time.",
      "Check the authentication server health and logs.",
      "Verify the credentials in configuration.",
      "Review OAuth/OIDC issuer, audience and scope settings.",
    ],
    suggestedFixes: [
      "Refresh or re-issue the token.",
      "Update credentials in the configuration.",
      "Fix the OAuth/OIDC configuration.",
    ],
    longTermImprovements: [
      "Add automated token rotation.",
      "Alert on authentication failure spikes.",
    ],
  },
  {
    id: "validation",
    name: "Validation Error",
    errorType: "Validation Error",
    baseSeverity: "Low",
    detect: (text) =>
      /\b(validation (?:error|failed|failure)|invalid (?:input|argument|payload|request|format)|constraint violation|not null constraint|missing (?:field|parameter|argument))\b/i.test(
        text,
      ),
    affectedComponents: [],
    rootCauses: [
      "Invalid or malformed input passed to the service.",
      "Schema or format mismatch between caller and callee.",
      "Constraint violation in the database.",
    ],
    investigation: [
      "Identify the invalid field and its expected format.",
      "Check the caller of the API.",
      "Check database constraints for the failing record.",
    ],
    suggestedFixes: [
      "Fix the caller input to match the expected format.",
      "Return a descriptive validation error to the caller.",
    ],
    longTermImprovements: [
      "Centralise input validation with clear error codes.",
      "Add contract tests between components.",
    ],
  },
  {
    id: "out-of-memory",
    name: "Out of Memory",
    errorType: "OutOfMemory",
    baseSeverity: "Critical",
    detect: (text) =>
      /\b(OutOfMemoryError|Java heap space|GC overhead limit exceeded|unable to allocate (?:memory|heap)|OOM)\b/i.test(
        text,
      ),
    affectedComponents: ["Application Runtime"],
    rootCauses: [
      "Heap space exhausted.",
      "Memory leak (unbounded caches or lists).",
      "Too many concurrent requests or very large payloads.",
    ],
    investigation: [
      "Check the remaining heap and GC logs around the failure.",
      "Identify the largest allocations (heap dump / profiler).",
      "Check for unbounded collections or caches in the code path.",
      "Check recent traffic or batch-size changes.",
    ],
    suggestedFixes: [
      "Restart the instance to restore service.",
      "Profile the heap and fix the largest allocations.",
    ],
    longTermImprovements: [
      "Add heap-usage monitoring and alerting.",
      "Fix memory leaks and cap cache or batch sizes.",
    ],
  },
  {
    id: "file-not-found",
    name: "File Not Found",
    errorType: "File Not Found",
    baseSeverity: "Medium",
    detect: (text) =>
      /\b(FileNotFoundException|NoSuchFileException|file not found|no such file or directory)\b/i.test(
        text,
      ),
    affectedComponents: [],
    rootCauses: [
      "Referenced file does not exist.",
      "Wrong path or insufficient permissions.",
      "File deleted or not mounted.",
    ],
    investigation: [
      "Verify the file exists at the referenced path.",
      "Check filesystem permissions.",
      "Check recent deployment or mount changes.",
    ],
    suggestedFixes: [
      "Create or restore the file.",
      "Fix the path or permissions.",
    ],
    longTermImprovements: [
      "Fail fast at startup if required files are missing.",
      "Centralise file-path configuration.",
    ],
  },
];

export function getRuleById(id: string): LogRule | undefined {
  return RULES.find((r) => r.id === id);
}
