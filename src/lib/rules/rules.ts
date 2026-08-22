import type { LogRule } from "@/types";

/**
 * Static rule catalogue for the rule-based log analysis engine (section 5).
 * Every rule is a set of detection patterns plus the guidance texts shown to
 * a production support engineer. A rule matches when ANY log line matches ANY
 * of its patterns; the matching lines become the rule's evidence.
 *
 * Conventions:
 * - Patterns are non-global and mostly line-scoped (no `\n`) so that evidence
 *   collection is exact and per-line.
 * - Prefer missed detections over false positives: a rule that fires without
 *   reason damages trust more than a missing rule.
 */

export const RULES: LogRule[] = [
  // ------------------------------------------------------------------
  // Existing rules (v1), now expressed as patterns.
  // ------------------------------------------------------------------
  {
    id: "null-pointer",
    name: "NullPointerException",
    errorType: "NullPointerException",
    baseSeverity: "High",
    patterns: [/\bNullPointerException\b/i],
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
    patterns: [
      /\b(SQLException|SQLSyntaxErrorException|SQLNonTransientException|SQLTransientException|SQLSTATE|DB2\s?error|ORA-\d+|deadlock|lock ?timeout|database ?(?:error|exception|down|unavailable)|cannot ?connect)\b/i,
      /\bSQL\b/i,
    ],
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
    patterns: [
      /\b(timeout|timed ?out|read ?timeout|connect(?:ion)? ?timeout|TimeoutException|SocketTimeoutException)\b/i,
    ],
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
    patterns: [
      /\b(connection refused|ECONNREFUSED|connect(?:ion)? (?:failed|failure|reset)|no route to host|unable to connect|cannot connect|could not connect)\b/i,
    ],
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
    patterns: [
      /(?:HTTP[/\s]+|status\s*[=:]\s*|statusCode\s*[=:]\s*)([4-5]\d\d)\b/i,
    ],
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
    patterns: [
      /\b(401|unauthorized|authentication failed|authenticat(?:ion|e) error|invalid token|expired token|access denied|invalid credential|token expired)\b/i,
    ],
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
    patterns: [
      /\b(validation (?:error|failed|failure)|invalid (?:input|argument|payload|request|format)|constraint violation|not null constraint|missing (?:field|parameter|argument))\b/i,
    ],
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
    patterns: [
      /\b(OutOfMemoryError|Java heap space|GC overhead limit exceeded|unable to allocate (?:memory|heap)|OOM)\b/i,
    ],
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
    patterns: [
      /\b(FileNotFoundException|NoSuchFileException|file not found|no such file or directory)\b/i,
    ],
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

  // ------------------------------------------------------------------
  // New rules (v1.1): high-frequency production failure patterns.
  // ------------------------------------------------------------------
  {
    id: "connection-pool",
    name: "Connection Pool Exhausted",
    errorType: "Connection Pool Exhausted",
    baseSeverity: "High",
    patterns: [
      /\b(connection pool (?:is )?(?:exhausted|full)|pool exhaustion|no available connection|all connections? (?:are )?in use|HikariPool[a-z0-9-]*(?: - Connection is not available| - Timeout after)|waiting for connection timeout)\b/i,
    ],
    affectedComponents: ["Database", "Application Runtime"],
    rootCauses: [
      "Pool size too small for the request rate.",
      "Connections leaked because they are never closed.",
      "Long-running queries or transactions holding connections.",
      "Database slow to accept new connections.",
    ],
    investigation: [
      "Check pool configuration and current utilisation at failure time.",
      "Look for code paths that acquire a connection without closing it.",
      "Check for long-running queries or uncommitted transactions.",
      "Check the database-side session count.",
    ],
    suggestedFixes: [
      "Increase the pool size or add acquire-retry with backoff.",
      "Close connections reliably (use try/finally or framework-managed pools).",
      "Reduce per-request connection hold time.",
    ],
    longTermImprovements: [
      "Monitor pool utilisation and alert before exhaustion.",
      "Add connection-leak detection to tests.",
    ],
  },
  {
    id: "thread-pool",
    name: "Thread Pool Exhausted",
    errorType: "Thread Pool Exhausted",
    baseSeverity: "High",
    patterns: [
      /\b(thread pool (?:is )?(?:exhausted|full|saturated)|RejectedExecutionException|TaskRejectedException|threadpool exhausted|unable to create new native thread|no threads available)\b/i,
    ],
    affectedComponents: ["Application Runtime"],
    rootCauses: [
      "Slow or blocked tasks occupying all pool threads.",
      "Blocking I/O (DB, HTTP) executed on request threads.",
      "Too many concurrent requests for the pool size.",
    ],
    investigation: [
      "Check pool size, active threads and queue backlog at failure time.",
      "Look for blocking calls (database, HTTP) inside pool tasks.",
      "Check request rate around the failure window.",
    ],
    suggestedFixes: [
      "Move blocking work to dedicated executors with bounded queues.",
      "Add timeouts to internal calls so tasks cannot block forever.",
      "Apply backpressure (e.g. reject with 503 instead of queueing unbounded).",
    ],
    longTermImprovements: [
      "Monitor pool utilisation and task queue depth.",
      "Refactor long call chains to async/event-driven patterns.",
    ],
  },
  {
    id: "ssl-tls",
    name: "SSL/TLS Error",
    errorType: "SSL/TLS Error",
    baseSeverity: "High",
    patterns: [
      /\b(SSLHandshakeException|TLSHandshakeException|SSLException|TLS error|handshake (?:failed|failure|error)|SSL_ERROR|javax\.net\.ssl|trustmanager (?:error|issue)|PKIX path building failed)\b/i,
    ],
    affectedComponents: ["Network", "Security"],
    rootCauses: [
      "Protocol or cipher mismatch between the two peers.",
      "Certificate chain problems (missing intermediate, wrong hostname).",
      "TLS version or SNI configuration mismatch.",
      "Intermediary (proxy/firewall) interfering with the handshake.",
    ],
    investigation: [
      "Compare TLS versions and cipher suites configured on both sides.",
      "Verify the full certificate chain and the trust store.",
      "Check SNI and TLS settings on the server and the client.",
      "Inspect for middleboxes rewriting or blocking the handshake.",
    ],
    suggestedFixes: [
      "Align TLS configuration on both peers.",
      "Update the CA bundle / trust store on the failing side.",
      "Fix the certificate (hostname/SAN, chain, expiry).",
    ],
    longTermImprovements: [
      "Centralise TLS configuration and roll it out consistently.",
      "Add a TLS version/cipher matrix test to the deployment pipeline.",
    ],
  },
  {
    id: "json-parse",
    name: "JSON Parse Error",
    errorType: "JSON Parse Error",
    baseSeverity: "Medium",
    patterns: [
      /\b(JSONParseException|JsonParseException|JSONException|unexpected (?:character|token)(?: [^\n]{0,40}in JSON)?|invalid JSON|malformed JSON|Failed to parse JSON|parse error[^\n]{0,40}json)\b/i,
    ],
    affectedComponents: [],
    rootCauses: [
      "Malformed payload sent by the caller.",
      "Wrong content type or character encoding.",
      "Truncated response or request body.",
      "Schema change between producer and consumer versions.",
    ],
    investigation: [
      "Validate the payload against a JSON linter.",
      "Identify the caller and check its content-type declaration.",
      "Check for truncation in transit (proxies, buffers).",
    ],
    suggestedFixes: [
      "Reject invalid payloads early with a clear error code.",
      "Fix the caller's serialisation or content type.",
      "Handle large or streamed bodies without truncation.",
    ],
    longTermImprovements: [
      "Add schema validation with contract tests on both sides.",
      "Log payload size and encoding metadata for debugging.",
    ],
  },
  {
    id: "serialization",
    name: "Serialization Error",
    errorType: "Serialization Error",
    baseSeverity: "Medium",
    patterns: [
      /\b(SerializationException|serialization failed|failed to serialize|unable to (?:serialize|deserialize)|NotSerializableException|DeserializationException|ClassCastException[^\n]{0,60}cannot be cast)\b/i,
    ],
    affectedComponents: [],
    rootCauses: [
      "Class version mismatch between producer and consumer.",
      "Incompatible schema evolution (added/removed/renamed fields).",
      "Missing default constructor or unsupported field type.",
    ],
    investigation: [
      "Compare class versions and serialVersionUID between sides.",
      "Check the schema registry for the serialised type.",
      "Review the object graph being serialised.",
    ],
    suggestedFixes: [
      "Align class versions or serialise explicit DTOs instead.",
      "Make schema changes backward compatible.",
      "Add a default constructor and supported types.",
    ],
    longTermImprovements: [
      "Adopt a schema registry with a compatibility policy.",
      "Add serialisation round-trip tests to CI.",
    ],
  },
  {
    id: "disk-full",
    name: "Disk Full",
    errorType: "Disk Full",
    baseSeverity: "High",
    patterns: [
      /\b(no space left on device|disk(?: is)? full|out of (?:disk|storage) space|ENOSPC)\b/i,
    ],
    affectedComponents: ["Storage"],
    rootCauses: [
      "Logs or temp files filling the partition.",
      "Application data growth without cleanup.",
      "Inode exhaustion on small filesystems.",
    ],
    investigation: [
      "Check partition usage (df -h) and the filesystem in question.",
      "Find the largest consumers (logs, temp, data files).",
      "Verify log rotation is actually running.",
    ],
    suggestedFixes: [
      "Free space immediately and restart affected services if needed.",
      "Configure log rotation and compression.",
      "Move data to a larger or dedicated volume.",
    ],
    longTermImprovements: [
      "Monitor disk usage with thresholds and alerting.",
      "Add automatic cleanup policies for temp and old logs.",
    ],
  },
  {
    id: "permission",
    name: "Permission Error",
    errorType: "Permission Error",
    baseSeverity: "Medium",
    patterns: [
      /\b(AccessDeniedException|PermissionError|permission denied|NOT permitted|operation not permitted|EACCES|EPERM|insufficient (?:file|directory|write) permissions?)\b/i,
    ],
    affectedComponents: [],
    rootCauses: [
      "Wrong file or directory ownership or mode.",
      "Service running as a different user than the resource owner.",
      "Security policy (SELinux / AppArmor / OS ACL) blocking access.",
    ],
    investigation: [
      "Inspect ownership and mode of the failing path.",
      "Compare the service account with the resource owner.",
      "Check the OS security policy for the path.",
    ],
    suggestedFixes: [
      "Fix ownership or mode to match the service user.",
      "Correct the service account configuration.",
      "Update the security policy to allow the intended access.",
    ],
    longTermImprovements: [
      "Treat ownership/mode as infrastructure-as-code.",
      "Review least-privilege configuration periodically.",
    ],
  },
  {
    id: "slow-query",
    name: "Slow Query",
    errorType: "Slow Query",
    baseSeverity: "Medium",
    patterns: [
      /\b(slow (?:query|sql)|query (?:took|takes) [0-9.]+\s*(?:ms|s)|statement timeout|long[- ]running (?:query|transaction))\b/i,
    ],
    affectedComponents: ["Database"],
    rootCauses: [
      "Missing or unused index triggering full scans.",
      "Lock contention with other transactions.",
      "Outdated statistics causing poor execution plans.",
    ],
    investigation: [
      "Capture the execution plan (EXPLAIN) for the failing query.",
      "Check index usage on WHERE and JOIN columns.",
      "Check concurrent transactions and lock waits.",
    ],
    suggestedFixes: [
      "Add or adjust indexes on filter and join columns.",
      "Rewrite the query or split it into smaller steps.",
      "Update statistics for the involved tables.",
    ],
    longTermImprovements: [
      "Review query plans as part of normal releases.",
      "Alert on slow-query thresholds and lock waits.",
    ],
  },
  {
    id: "rate-limit",
    name: "Rate Limit",
    errorType: "Rate Limit",
    baseSeverity: "Medium",
    patterns: [
      /\b(rate ?limit(?:ed|ing)?|too many requests|throttl(?:e|ed|ing)|quota exceeded)\b/i,
    ],
    affectedComponents: ["External API", "API Gateway"],
    rootCauses: [
      "Burst traffic exceeding the allowed rate.",
      "Subscription/plan quota exhausted.",
      "Clients retrying without backoff, creating a retry storm.",
      "Shared credential hitting another consumer's limit.",
    ],
    investigation: [
      "Check gateway logs for rate-limit headers and counters.",
      "Review call volume per client/credential at failure time.",
      "Look for tight retry loops amplifying the volume.",
    ],
    suggestedFixes: [
      "Implement exponential backoff with jitter on retries.",
      "Increase the quota or plan where justified.",
      "Cache or batch duplicate calls to reduce volume.",
    ],
    longTermImprovements: [
      "Make clients rate-limit aware (respect Retry-After).",
      "Monitor limit headroom and alert before exhaustion.",
    ],
  },
  {
    id: "circuit-breaker",
    name: "Circuit Breaker",
    errorType: "Circuit Breaker",
    baseSeverity: "High",
    patterns: [
      /\b(circuit (?:breaker )?(?:open|opened)|CircuitBreakerOpenException|circuit breaker (?:tripped|activated|fired)|bulkhead(?: reached| full)?|HystrixRuntimeException|resilience4j|fallback (?:method|triggered|executed))\b/i,
    ],
    affectedComponents: ["External API"],
    rootCauses: [
      "Downstream unhealthy, breaker opened after failures.",
      "Failure or timeout threshold exceeded in the window.",
      "Slow downstream prolonging the open state.",
    ],
    investigation: [
      "Check the downstream service health and its own logs.",
      "Review breaker configuration (thresholds, window, timeout).",
      "Check the downstream error rate over the window.",
    ],
    suggestedFixes: [
      "Fix or restart the downstream service to let the breaker reset.",
      "Adjust thresholds only with evidence from metrics.",
      "Provide a meaningful fallback instead of failing through.",
    ],
    longTermImprovements: [
      "Set SLOs and dashboards for breaker open/closed states.",
      "Test breaker behaviour in failure-injection drills.",
    ],
  },
  {
    id: "messaging",
    name: "Messaging Error",
    errorType: "Messaging Error",
    baseSeverity: "High",
    patterns: [
      /\b(KafkaException|kafka [a-z]* (?:error|failed|failure|unavailable)|MQTT error|JMSException|message (?:queue|broker) (?:error|unavailable|down|failed)|consumer (?:error|failed|rebalance|stuck)|producer (?:error|failed)|delivery failed|NoBrokersAvailable|KafkaTimeoutException)\b/i,
    ],
    affectedComponents: ["Messaging"],
    rootCauses: [
      "Broker down or unreachable.",
      "Consumer group lag or rebalance loops.",
      "Message larger than the broker limit.",
      "Topic or partition gone / ACL denied.",
    ],
    investigation: [
      "Check broker health, partitions and storage.",
      "Check consumer group lag and rebalance activity.",
      "Compare message size against max.message.bytes.",
      "Verify topic ACLs for producer and consumer.",
    ],
    suggestedFixes: [
      "Restart or repair the broker; confirm replicas are in sync.",
      "Fix the consumer group offset strategy or add partitions.",
      "Tune message or batch size limits.",
    ],
    longTermImprovements: [
      "Monitor consumer lag and broker capacity.",
      "Define retention and compaction policies per topic.",
    ],
  },
  {
    id: "cache",
    name: "Cache Error",
    errorType: "Cache Error",
    baseSeverity: "Medium",
    patterns: [
      /\b(RedisException|redis (?:error|unavailable|down|timeout|connection|out of memory)|jedis|lettuce\b|cache (?:server|provider) (?:error|unavailable|down))\b/i,
    ],
    affectedComponents: ["Cache Server"],
    rootCauses: [
      "Cache server down, restarted or evicting under memory pressure.",
      "maxmemory policy evicting hot keys.",
      "Serialisation or type mismatch between writer and reader.",
    ],
    investigation: [
      "Check cache server health, memory and eviction stats.",
      "Check key hit/miss rates around the failure.",
      "Verify the data stored for the failing key.",
    ],
    suggestedFixes: [
      "Restart or fix the cache server; re-warm hot keys.",
      "Tune maxmemory-policy and TTLs.",
      "Align serialisation between readers and writers.",
    ],
    longTermImprovements: [
      "Degrade gracefully when the cache is unavailable.",
      "Monitor evictions and memory headroom.",
    ],
  },
  {
    id: "dns",
    name: "DNS Error",
    errorType: "DNS Error",
    baseSeverity: "Medium",
    patterns: [
      /\b(UnknownHostException|DNS (?:resolution )?(?:error|failed|failure)|dns lookup (?:error|failed|failure)|Failed to resolve (?:host|hostname)|no such host|NameNotFoundException)\b/i,
    ],
    affectedComponents: ["DNS"],
    rootCauses: [
      "DNS server down or slow to respond.",
      "Record removed or wrong zone updated.",
      "Search domain or resolver configuration mismatch.",
    ],
    investigation: [
      "Resolve the host with nslookup/dig and compare answers.",
      "Check the resolver configuration on the node.",
      "Compare records across DNS servers and zones.",
    ],
    suggestedFixes: [
      "Fix or update the DNS records.",
      "Correct the resolver configuration.",
      "Add a fallback resolver or local hosts entry for critical hosts.",
    ],
    longTermImprovements: [
      "Monitor DNS resolution latency and failures.",
      "Cache DNS with TTL awareness in the application.",
    ],
  },
  {
    id: "batch-job",
    name: "Batch Job Failure",
    errorType: "Batch Job Failure",
    baseSeverity: "High",
    patterns: [
      /\b(batch (?:job|process|run|step) (?:failed|error|interrupted|aborted|stopped)|job (?:execution )?(?:failed|error|aborted)|Spring Batch[^\n]{0,40}(?:failure|error)|step execution failed|ItemWriterException|skip limit exceeded)\b/i,
    ],
    affectedComponents: ["Batch"],
    rootCauses: [
      "A bad input record aborts the whole chunk.",
      "Database lock contention at batch scale.",
      "External call timeout inside the job.",
      "Job restarted without proper checkpointing.",
    ],
    investigation: [
      "Check the job log for the failing chunk and step.",
      "Identify the first bad record and its content.",
      "Verify the restart/checkpoint behaviour for the job.",
    ],
    suggestedFixes: [
      "Skip or quarantine bad records instead of aborting the batch.",
      "Isolate per-record failures within the chunk.",
      "Restart the job from the last checkpoint.",
    ],
    longTermImprovements: [
      "Design jobs to be idempotent and resumable.",
      "Alert on job failures and track completion SLAs.",
    ],
  },
  {
    id: "configuration",
    name: "Configuration Error",
    errorType: "Configuration Error",
    baseSeverity: "High",
    patterns: [
      /\b(configuration error|config (?:file )?missing|missing configuration|invalid configuration|failed to (?:load|parse|read) (?:config|configuration)|PropertyNotFoundException|unknown property|no bean named|Unable to load (?:application\.properties|application\.yml)|environment variable[^\n]{0,40}not (?:set|found)|Could not resolve placeholder)\b/i,
    ],
    affectedComponents: [],
    rootCauses: [
      "Missing environment variable or secret.",
      "Wrong or outdated value in the config file.",
      "Profile mismatch (dev config in prod, or vice versa).",
      "Typo in a property name.",
    ],
    investigation: [
      "Diff the configuration across environments.",
      "Check environment variables and the secret store.",
      "Verify the active profile and its source precedence.",
    ],
    suggestedFixes: [
      "Set the correct value or secret for the environment.",
      "Fix the config file or property name.",
      "Align the activation profile with the deployment.",
    ],
    longTermImprovements: [
      "Validate configuration at startup (fail fast with clear messages).",
      "Add config schema tests and centralise secrets management.",
    ],
  },
  {
    id: "certificate",
    name: "Certificate Error",
    errorType: "Certificate Error",
    baseSeverity: "High",
    patterns: [
      /\b(certificate (?:expired|not yet valid|untrusted|unknown|revoked)|CertPathValidatorException|SSLPeerUnverifiedException|X509(?:Certificate)?(?:Exception|Error)|unable to find valid certification path|sun\.security\.validator)\b/i,
    ],
    affectedComponents: ["Security"],
    rootCauses: [
      "Certificate expired or not yet valid.",
      "Missing intermediate CA in the chain.",
      "Hostname mismatch (wrong SAN on the certificate).",
      "Clock skew on one of the peers.",
    ],
    investigation: [
      "Inspect the certificate dates, SAN and chain (openssl s_client).",
      "Check the trust store on the failing side.",
      "Compare system clocks between the peers.",
    ],
    suggestedFixes: [
      "Renew and redeploy the certificate.",
      "Install the full intermediate chain.",
      "Fix the hostname used to call the service (or the SAN).",
    ],
    longTermImprovements: [
      "Monitor certificate expiry with alerts (e.g. 30 days before).",
      "Automate renewal and chain deployment.",
    ],
  },
  {
    id: "websocket",
    name: "WebSocket Error",
    errorType: "WebSocket Error",
    baseSeverity: "Medium",
    patterns: [
      /\b(WebSocketException|websocket (?:error|failed|closed|disconnected|connection (?:lost|reset|failed))|WS connection (?:lost|closed|error)|unexpected websocket close)\b/i,
    ],
    affectedComponents: [],
    rootCauses: [
      "Idle timeout closing the socket.",
      "Proxy/load balancer idle timeout shorter than the app's.",
      "Server restart or deploy dropping active sockets.",
      "Network drop between client and server.",
    ],
    investigation: [
      "Compare proxy/LB idle timeouts with client ping intervals.",
      "Check for restarts or deploys at the failure time.",
      "Check network stability between the endpoints.",
    ],
    suggestedFixes: [
      "Add ping/pong keepalive on the client.",
      "Align proxy and application timeouts.",
      "Implement reconnect with exponential backoff.",
    ],
    longTermImprovements: [
      "Heartbeat and auto-reconnect as a client standard.",
      "Monitor WebSocket connection counts and drops.",
    ],
  },
  {
    id: "encoding",
    name: "Encoding Error",
    errorType: "Encoding Error",
    baseSeverity: "Medium",
    patterns: [
      /\b(UnsupportedEncodingException|MalformedInputException|invalid byte sequence|character (?:encoding|set) (?:error|mismatch|invalid)|illegal (?:byte|escape|character) sequence|Cannot decode|unmappable character)\b/i,
    ],
    affectedComponents: [],
    rootCauses: [
      "Mixed encodings between producer and consumer.",
      "Missing charset declaration on connection or file.",
      "Binary data placed in a text field.",
    ],
    investigation: [
      "Compare the declared charset with the actual byte content.",
      "Identify the source of the mis-encoded string.",
      "Inspect a sample of the raw bytes (hexdump).",
    ],
    suggestedFixes: [
      "Standardise on UTF-8 end-to-end.",
      "Declare the charset on connections, files and responses.",
      "Reject non-text data at the boundary.",
    ],
    longTermImprovements: [
      "Enforce an encoding policy across services.",
      "Add encoding validation to ingestion pipelines.",
    ],
  },

  // ------------------------------------------------------------------
  // Real-world rules added from LogHub coverage (v1.3).
  // ------------------------------------------------------------------
  {
    id: "coordination",
    name: "Coordination Service (ZooKeeper)",
    errorType: "Coordination Error",
    baseSeverity: "High",
    patterns: [
      /\b(KeeperException|NoNodeException|NodeExistsException|ConnectionLossException|SessionExpiredException|ZooKeeperException|session expired|connection loss|no node)\b/i,
    ],
    affectedComponents: ["ZooKeeper"],
    rootCauses: [
      "ZooKeeper session expired or lost.",
      "Node/znode missing or already exists.",
      "Coordination service restarted or partitioned.",
    ],
    investigation: [
      "Check the ZooKeeper ensemble health and session stats.",
      "Verify the znode exists and its ACLs.",
      "Check for leader elections or quorum loss around the failure time.",
    ],
    suggestedFixes: [
      "Reconnect with session restore/retry.",
      "Recreate the missing node or fix the create/check ordering.",
      "Confirm quorum and ensemble stability.",
    ],
    longTermImprovements: [
      "Monitor session and quorum metrics.",
      "Implement idempotent node creation with proper retry/backoff.",
    ],
  },
  {
    id: "android-crash",
    name: "Android Crash",
    errorType: "Android Crash",
    baseSeverity: "High",
    patterns: [
      // Android-specific signatures only — a bare "FATAL EXCEPTION" appears
      // in non-Android logs too (e.g. supercomputer kernel messages).
      /\bAndroidRuntime(?:Exception)?\b/i,
      /\bANR in\b/i,
      /\bProcess: [^\n]{0,60}, PID: \d+\b/i,
    ],
    affectedComponents: ["Android App"],
    rootCauses: [
      "Uncaught exception crashed the app process.",
      "Main-thread work exceeded the ANR window.",
      "Missing condition in UI/background thread interaction.",
    ],
    investigation: [
      "Start from the topmost stack frame of the FATAL EXCEPTION.",
      "Check device/OS version and whether it is reproducible.",
      "Look at the last user action before the crash.",
    ],
    suggestedFixes: [
      "Wrap the failing path in try/catch and log context.",
      "Move blocking work off the main thread.",
      "Fix the null/state assumption in the top stack frame.",
    ],
    longTermImprovements: [
      "Add crash reporting (e.g. Play Console / Crashlytics) with the same format.",
      "Add instrumentation tests for the reproducing flow.",
    ],
  },
  {
    id: "web-server",
    name: "Web Server Error",
    errorType: "Web Server Error",
    baseSeverity: "Medium",
    patterns: [
      /\b(workerEnv in error state|child worker[^\n]{0,40}in error|mod_jk[^\n]{0,40}(?:error|failed)|Address already in use)\b/i,
    ],
    affectedComponents: ["Web Server"],
    rootCauses: [
      "Worker/backend node in error state inside the web server.",
      "Port or socket already bound by another process.",
      "Misconfigured worker pool or unhealthy backend.",
    ],
    investigation: [
      "Check the web server worker status and backend health.",
      "List what holds the port (lsof/ss).",
      "Review virtual host and worker configuration.",
    ],
    suggestedFixes: [
      "Restart or drain the failing worker node.",
      "Free the port or change the listener binding.",
      "Correct the worker/balancer configuration.",
    ],
    longTermImprovements: [
      "Monitor worker error states and backend health checks.",
      "Standardise listener port allocation to avoid clashes.",
    ],
  },
];

export function getRuleById(id: string): LogRule | undefined {
  return RULES.find((r) => r.id === id);
}