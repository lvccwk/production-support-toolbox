import type { HttpStatusEntry } from "@/types";

/**
 * HTTP status helper data (section 11). A searchable reference: meaning,
 * common production causes and what to check, for every standard code.
 */

interface RawStatus {
  code: number;
  phrase: string;
  meaning: string;
  causes: string[];
  checks: string[];
}

export const HTTP_STATUS_RAW: RawStatus[] = [
  { code: 100, phrase: "Continue", meaning: "Client should continue with the request.", causes: [], checks: [] },
  { code: 101, phrase: "Switching Protocols", meaning: "Server is switching protocols as requested.", causes: [], checks: [] },
  { code: 102, phrase: "Processing", meaning: "Server received and is processing the request (WebDAV).", causes: [], checks: [] },
  { code: 103, phrase: "Early Hints", meaning: "Server sends headers early to speed up loading.", causes: [], checks: [] },
  { code: 200, phrase: "OK", meaning: "Request succeeded.", causes: [], checks: [] },
  { code: 201, phrase: "Created", meaning: "Request succeeded and a resource was created.", causes: [], checks: [] },
  { code: 202, phrase: "Accepted", meaning: "Request accepted for processing, not yet completed.", causes: [], checks: [] },
  { code: 203, phrase: "Non-Authoritative Information", meaning: "Returned metadata is not from the origin server.", causes: [], checks: [] },
  { code: 204, phrase: "No Content", meaning: "Request succeeded but there is no content to return.", causes: [], checks: [] },
  { code: 205, phrase: "Reset Content", meaning: "Request succeeded; client should reset the document view.", causes: [], checks: [] },
  { code: 206, phrase: "Partial Content", meaning: "Partial content delivered (byte ranges).", causes: [], checks: [] },
  { code: 300, phrase: "Multiple Choices", meaning: "Multiple representations available; client should choose.", causes: [], checks: [] },
  { code: 301, phrase: "Moved Permanently", meaning: "Resource moved permanently; update links and bookmarks.", causes: ["Permanent URL change not propagated to clients or config."], checks: ["Check the redirect target and update client/config URLs.", "Check DNS and load-balancer rules."] },
  { code: 302, phrase: "Found (Temporary Redirect)", meaning: "Resource found at a different URI temporarily.", causes: ["Temporary redirect caused by auth or locale logic."], checks: ["Check the redirect target and application routing rules."] },
  { code: 303, phrase: "See Other", meaning: "Response to a POST can be fetched via GET at another URI.", causes: [], checks: [] },
  { code: 304, phrase: "Not Modified", meaning: "Cached copy is still valid (conditional request).", causes: [], checks: [] },
  { code: 307, phrase: "Temporary Redirect", meaning: "Temporary redirect; method must not change.", causes: ["Downstream service moved temporarily."], checks: ["Check the redirect target's health."] },
  { code: 308, phrase: "Permanent Redirect", meaning: "Permanent redirect; method must not change.", causes: ["Permanent URL change."], checks: ["Update client/config URLs."] },
  { code: 400, phrase: "Bad Request", meaning: "Request is malformed or contains invalid data.", causes: ["Malformed request body or headers.", "Invalid JSON/XML payload.", "Client/server contract mismatch.", "Oversized request rejected by the server or gateway."], checks: ["Inspect the request payload against the API contract.", "Check client version vs server API version.", "Check gateway/WAF rules rejecting the request."] },
  { code: 401, phrase: "Unauthorized", meaning: "Authentication is missing or failed.", causes: ["Missing or invalid token.", "Expired token.", "Wrong credentials.", "Authentication server rejecting the request."], checks: ["Check token expiry and issuance.", "Check credentials in configuration.", "Check the authentication server health and logs.", "Review OAuth/OIDC issuer, audience and scope."] },
  { code: 402, phrase: "Payment Required", meaning: "Reserved for future use (payment required).", causes: [], checks: [] },
  { code: 403, phrase: "Forbidden", meaning: "Server understood the request but refuses to authorise it.", causes: ["Role or permission missing.", "IP/geo allow-list denies the caller.", "Shared user used in the wrong environment.", "WAF or security policy blocks the request."], checks: ["Check the caller's roles and permissions.", "Check network allow-lists.", "Check security policy / WAF logs.", "Confirm the correct environment and shared account."] },
  { code: 404, phrase: "Not Found", meaning: "The requested resource does not exist.", causes: ["Wrong URL or endpoint.", "Resource deleted or never deployed.", "Service routing to the wrong instance.", "Load balancer or gateway misconfiguration."], checks: ["Verify the URL and endpoint name.", "Check recent deployments and routing rules.", "Check the route table / gateway config.", "Confirm the resource exists in the environment."] },
  { code: 405, phrase: "Method Not Allowed", meaning: "HTTP method is not supported for this resource.", causes: ["Client used the wrong method (e.g. POST vs PUT)."], checks: ["Check the API contract for allowed methods."] },
  { code: 406, phrase: "Not Acceptable", meaning: "Response format does not satisfy Accept headers.", causes: ["Client requests an unsupported content type."], checks: ["Check Accept header vs server-supported formats."] },
  { code: 407, phrase: "Proxy Authentication Required", meaning: "Proxy requires authentication.", causes: ["Missing proxy credentials on the client side."], checks: ["Check proxy configuration and credentials."] },
  { code: 408, phrase: "Request Timeout", meaning: "Server timed out waiting for the request.", causes: ["Slow client/network.", "Large upload exceeding the timeout."], checks: ["Check network latency and client behaviour.", "Increase server receive timeout where appropriate."] },
  { code: 409, phrase: "Conflict", meaning: "Request conflicts with the current state of the resource.", causes: ["Concurrent updates to the same record.", "Version/ETag mismatch.", "Uniqueness constraint violated."], checks: ["Check concurrent writers to the same record.", "Verify the client used the latest version/ETag.", "Check DB constraints on the failing record."] },
  { code: 410, phrase: "Gone", meaning: "Resource is permanently gone (removed).", causes: ["Resource intentionally removed."], checks: ["Update or remove the client reference."] },
  { code: 411, phrase: "Length Required", meaning: "Content-Length header is required.", causes: ["Chunked/invalid request without length."], checks: ["Check client request framing."] },
  { code: 412, phrase: "Precondition Failed", meaning: "Precondition headers (If-Match etc.) failed.", causes: ["ETag/version changed since the client fetched it."], checks: ["Re-fetch the resource and retry with the new version."] },
  { code: 413, phrase: "Payload Too Large", meaning: "Request body is larger than the server limit.", causes: ["Upload exceeds size limits.", "Reverse proxy body-size limit too small."], checks: ["Check the request size vs server/proxy limits.", "Raise the limit if the payload is legitimate."] },
  { code: 414, phrase: "URI Too Long", meaning: "Request URI is longer than the server limit.", causes: ["GET query string too long."], checks: ["Switch to POST or shorten the query string.", "Check proxy URI length limits."] },
  { code: 415, phrase: "Unsupported Media Type", meaning: "Content-Type is not supported.", causes: ["Wrong Content-Type header (e.g. text/plain vs application/json)."], checks: ["Check the client Content-Type header.", "Verify the API contract."] },
  { code: 416, phrase: "Range Not Satisfiable", meaning: "Requested byte range is invalid.", causes: ["Client requested an invalid range."], checks: ["Check the client range logic."] },
  { code: 417, phrase: "Expectation Failed", meaning: "Expect header cannot be satisfied.", causes: ["Client Expect header unsupported by the server."], checks: ["Check the Expect header usage."] },
  { code: 418, phrase: "I'm a Teapot", meaning: "Humorous (RFC 2324); server refuses to brew coffee.", causes: [], checks: [] },
  { code: 421, phrase: "Misdirected Request", meaning: "Request sent to a server that cannot respond.", causes: ["SNI/host mismatch on shared hosting."], checks: ["Check host header and SNI routing."] },
  { code: 422, phrase: "Unprocessable Entity", meaning: "Request is well-formed but semantically invalid.", causes: ["Business validation failed.", "Missing required fields.", "Invalid enum/reference values."], checks: ["Read the validation error details.", "Check the payload against the schema.", "Check business rules for the submitted data."] },
  { code: 423, phrase: "Locked", meaning: "Resource is locked (WebDAV).", causes: ["Record locked by another process."], checks: ["Check long-running transactions/locks."] },
  { code: 424, phrase: "Failed Dependency", meaning: "Request failed because a dependency failed (WebDAV).", causes: ["Upstream dependency failed."], checks: ["Check upstream service health."] },
  { code: 425, phrase: "Too Early", meaning: "Server refuses a replay risk (TLS 1.3 early data).", causes: [], checks: [] },
  { code: 426, phrase: "Upgrade Required", meaning: "Server requires a protocol upgrade.", causes: [], checks: [] },
  { code: 428, phrase: "Precondition Required", meaning: "Server requires conditional headers.", causes: [], checks: [] },
  { code: 429, phrase: "Too Many Requests", meaning: "Client sent too many requests (rate limiting).", causes: ["Rate limit exceeded.", "Runaway loop or retry storm.", "Shared IP quota exhausted.", "Misconfigured rate-limit threshold too low."], checks: ["Check the Retry-After header.", "Review client retry loops and parallelism.", "Check rate-limit configuration and quotas.", "Check for a burst of traffic from one caller."] },
  { code: 431, phrase: "Request Header Fields Too Large", meaning: "Request headers exceed the server limit.", causes: ["Oversized cookies or headers."], checks: ["Reduce cookie/header size.", "Check proxy header limits."] },
  { code: 451, phrase: "Unavailable For Legal Reasons", meaning: "Blocked for legal reasons.", causes: [], checks: [] },
  { code: 500, phrase: "Internal Server Error", meaning: "Unexpected server error; request could not be completed.", causes: ["Unhandled exception in application code.", "Null pointer or bad state in a request path.", "Configuration or dependency failure inside the app.", "Memory/timeout issue in the request handler."], checks: ["Find the exception and stack trace in application logs.", "Check the failing request path and inputs.", "Check recent deployment and configuration changes.", "Check JVM/process health (heap, threads)."] },
  { code: 501, phrase: "Not Implemented", meaning: "Server does not support the requested function.", causes: ["Feature not implemented on the server.", "Wrong endpoint on an older server version."], checks: ["Confirm the server version supports the endpoint."] },
  { code: 502, phrase: "Bad Gateway", meaning: "Upstream server returned an invalid response.", causes: ["Upstream application crashed or hung.", "Reverse proxy cannot reach the backend.", "Backend returned a malformed response.", "Upstream timed out at the proxy layer."], checks: ["Check backend application health and logs.", "Check backend availability from the proxy node.", "Check upstream timeouts and retry settings.", "Check recent deployment of the backend."] },
  { code: 503, phrase: "Service Unavailable", meaning: "Service temporarily unavailable.", causes: ["Application down", "No healthy backend instances", "Service overload", "Dependency failure"], checks: ["Check application health.", "Check pods/instances and their health checks.", "Check upstream dependencies.", "Check recent deployment."] },
  { code: 504, phrase: "Gateway Timeout", meaning: "Upstream server did not respond in time.", causes: ["Backend slow or hung.", "Backend overwhelmed by load.", "Proxy timeout too short for slow operations.", "Deadlock or thread-pool exhaustion in the backend."], checks: ["Check backend response times and logs.", "Check thread/connection pools in the backend.", "Review proxy timeout settings.", "Check for lock contention or deadlocks."] },
  { code: 505, phrase: "HTTP Version Not Supported", meaning: "HTTP version used by the client is not supported.", causes: [], checks: [] },
  { code: 506, phrase: "Variant Also Negotiates", meaning: "Server configuration error in content negotiation.", causes: [], checks: [] },
  { code: 507, phrase: "Insufficient Storage", meaning: "Server cannot store the representation (WebDAV).", causes: ["Disk full or quota exceeded."], checks: ["Check disk space and storage quotas."] },
  { code: 508, phrase: "Loop Detected", meaning: "Infinite loop detected in processing (WebDAV).", causes: ["Circular reference or redirect loop."], checks: ["Review redirect chains and processing logic."] },
  { code: 510, phrase: "Not Extended", meaning: "Further extensions required (RFC 2774, obsolete).", causes: [], checks: [] },
  { code: 511, phrase: "Network Authentication Required", meaning: "Network access requires authentication (captive portal).", causes: ["Captive portal intercepting client traffic."], checks: ["Check client network connectivity/portal."] },
];

export const HTTP_STATUS_CATALOG: HttpStatusEntry[] = HTTP_STATUS_RAW.map((raw) => ({
  code: raw.code,
  phrase: raw.phrase,
  category: `${Math.floor(raw.code / 100)}xx` as HttpStatusEntry["category"],
  meaning: raw.meaning,
  commonCauses: raw.causes,
  whatToCheck: raw.checks,
}));

/** Search by code number or any text (phrase, meaning, causes). */
export function searchHttpStatus(query: string): HttpStatusEntry[] {
  const trimmed = query.trim();
  if (!trimmed) return HTTP_STATUS_CATALOG;
  const q = trimmed.toLowerCase();
  const numeric = /^\d{3}$/.test(trimmed) ? Number(trimmed) : null;
  return HTTP_STATUS_CATALOG.filter((entry) => {
    if (numeric !== null && entry.code === numeric) return true;
    if (entry.phrase.toLowerCase().includes(q)) return true;
    if (entry.meaning.toLowerCase().includes(q)) return true;
    return entry.commonCauses.some((c) => c.toLowerCase().includes(q));
  });
}

export function getHttpStatus(code: number): HttpStatusEntry | undefined {
  return HTTP_STATUS_CATALOG.find((entry) => entry.code === code);
}