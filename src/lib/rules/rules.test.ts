import { describe, expect, it } from "vitest";
import { analyzeLogText } from "./engine";

/**
 * Catalogue coverage: every rule must fire on a positive sample and stay
 * silent on a near-miss negative sample. The negative samples are only
 * required to NOT trigger the rule under test — other rules may legitimately
 * match different keywords in the same text.
 */
const CASES: Array<{ id: string; pos: string; neg: string }> = [
  {
    id: "null-pointer",
    pos: "ERROR NullPointerException at run",
    neg: "INFO null pointer suspected in review",
  },
  {
    id: "sql-error",
    pos: "ERROR SQLSTATE 40001 deadlock detected",
    neg: "INFO sqlite backup started",
  },
  {
    id: "timeout",
    pos: "ERROR read timeout after 30s",
    neg: "INFO timeouts configured to 3",
  },
  {
    id: "connection-failure",
    pos: "ERROR connection refused to 10.0.0.5:5432",
    neg: "INFO connecting to gateway",
  },
  {
    id: "http-error",
    pos: "ERROR Request failed: HTTP 500",
    neg: "INFO http request #2 done",
  },
  {
    id: "authentication",
    pos: "ERROR 401 unauthorized for api.example.com",
    neg: "INFO auth module initialized",
  },
  {
    id: "validation",
    pos: "ERROR validation failed for field amount",
    neg: "INFO input processed",
  },
  {
    id: "out-of-memory",
    pos: "FATAL OutOfMemoryError: Java heap space",
    neg: "INFO memory usage 60%",
  },
  {
    id: "file-not-found",
    pos: "ERROR FileNotFoundException: /etc/app.conf",
    neg: "INFO found 3 files",
  },
  {
    id: "connection-pool",
    pos: "ERROR connection pool exhausted at HikariPool-2",
    neg: "INFO acquired connection from pool",
  },
  {
    id: "thread-pool",
    pos: "ERROR java.util.concurrent.RejectedExecutionException: queue is full",
    neg: "INFO thread pool idle",
  },
  {
    id: "ssl-tls",
    pos: "ERROR javax.net.ssl.SSLHandshakeException: handshake failed",
    neg: "INFO SSL enabled for connection",
  },
  {
    id: "json-parse",
    pos: "ERROR JsonParseException: Unexpected character in JSON",
    neg: "INFO sent JSON payload",
  },
  {
    id: "serialization",
    pos: "ERROR SerializationException: unable to serialize object",
    neg: "INFO serialized 42 records",
  },
  {
    id: "disk-full",
    pos: "ERROR No space left on device while writing log",
    neg: "INFO disk usage 45%",
  },
  {
    id: "permission",
    pos: "ERROR permission denied for path /var/tmp/app",
    neg: "INFO permission check done",
  },
  {
    id: "slow-query",
    pos: "ERROR slow query detected: SELECT * FROM orders",
    neg: "INFO query executed in 3ms",
  },
  {
    id: "rate-limit",
    pos: "ERROR Rate limit exceeded for api.example.com",
    neg: "INFO limit value set to 10",
  },
  {
    id: "circuit-breaker",
    pos: "ERROR CircuitBreakerOpenException: circuit is open",
    neg: "INFO circuit manually checked",
  },
  {
    id: "messaging",
    pos: "ERROR NoBrokersAvailable: kafka broker unreachable",
    neg: "INFO kafka topic created",
  },
  {
    id: "cache",
    pos: "ERROR RedisException: redis connection timeout",
    neg: "INFO redis cache hit ratio 95%",
  },
  {
    id: "dns",
    pos: "ERROR UnknownHostException: api.internal.example",
    neg: "INFO connected to host api.internal.example",
  },
  {
    id: "batch-job",
    pos: "ERROR batch job failed at step 3",
    neg: "INFO batch job completed",
  },
  {
    id: "configuration",
    pos: "ERROR Could not resolve placeholder 'db.url'",
    neg: "INFO configuration loaded in 12ms",
  },
  {
    id: "certificate",
    pos: "ERROR certificate expired for api.example.com",
    neg: "INFO certificate renewed yesterday",
  },
  {
    id: "websocket",
    pos: "ERROR websocket connection reset by peer",
    neg: "INFO websocket connected",
  },
  {
    id: "encoding",
    pos: "ERROR UnsupportedEncodingException: UTF-16 not supported",
    neg: "INFO encoding=utf-8 declared",
  },
  {
    id: "coordination",
    pos: "ERROR KeeperException$SessionExpiredException: session expired",
    neg: "INFO zookeeper session created",
  },
  {
    id: "android-crash",
    pos: "E AndroidRuntime: FATAL EXCEPTION: main",
    neg: "INFO process started com.example.app",
  },
  {
    id: "web-server",
    pos: "ERROR mod_jk child workerEnv in error state 6",
    neg: "INFO worker started successfully",
  },
];

describe("rule catalogue coverage", () => {
  it.each(CASES)(
    "$id matches its positive sample and ignores its negative sample",
    ({ id, pos, neg }) => {
      expect(analyzeLogText(pos).matchedRuleIds).toContain(id);
      expect(analyzeLogText(neg).matchedRuleIds).not.toContain(id);
    },
  );

  it("collects evidence from the exact matching line", () => {
    const result = analyzeLogText(
      "INFO pool ok\nERROR no available connection from pool",
    );
    const m = result.matchedEvidence.find((x) => x.ruleId === "connection-pool");
    expect(m?.evidence.map((e) => e.line)).toEqual([2]);
    expect(m?.evidence[0]?.text).toBe("ERROR no available connection from pool");
  });
});