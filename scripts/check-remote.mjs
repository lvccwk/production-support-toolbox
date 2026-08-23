/**
 * Pre-start guard for remote mode (`npm run dev:remote` / `start:remote`):
 * refuses to start the server unless remote access is explicitly requested
 * AND at least one API credential is configured (fail closed, Engineering
 * Review §3).
 *
 * `npm run dev` / `npm run start` bind to 127.0.0.1 (loopback-only) and
 * never run this check.
 */

const remote = process.env.PST_REMOTE_ACCESS === "true";
const token =
  process.env.PST_API_TOKEN ||
  process.env.PST_API_TOKEN_WRITE ||
  process.env.PST_API_TOKEN_READ;

const fail = (message) => {
  console.error(`[pst] ${message}`);
  process.exit(1);
};

if (!remote) {
  fail(
    "PST_REMOTE_ACCESS must be 'true' to use the :remote scripts. Use `npm run dev` for loopback-only mode.",
  );
}
if (!token) {
  fail(
    "Remote mode requires at least one credential: PST_API_TOKEN (admin), PST_API_TOKEN_WRITE or PST_API_TOKEN_READ. " +
      "Refusing to start without credentials (fail closed).",
  );
}

if (token.length < 16) {
  fail("API tokens must be at least 16 characters (use a high-entropy value, e.g. `openssl rand -hex 32`).");
}

console.log(
  "[pst] Remote mode: binding 0.0.0.0 with bearer-token access control (read/write/admin scopes).",
);

// Keep playwright-style wrappers honest: the scripts chain `&& next ...`,
// so this process must exit 0 once the checks pass.
process.exit(0);