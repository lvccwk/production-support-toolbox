import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { sanitizeError } from "@/lib/errors";
import {
  runAnalyze,
  runCompare,
  runEncoding,
  runJson,
  runSql,
  runTimestamp,
} from "@/lib/tools/runners";

/**
 * MCP server — the agent-native surface of the toolbox.
 *
 * Wraps the SAME shared tool runners as the HTTP Agent API
 * (src/lib/tools/runners.ts), so Claude Code / Cursor / opencode / any MCP
 * client gets byte-identical logic to `POST /api/tools/*`, with no drift
 * possible between the two surfaces.
 *
 * Transport: stdio (newline-delimited JSON-RPC 2.0 over stdin/stdout).
 * IMPORTANT: nothing may ever write to stdout except the protocol — all
 * diagnostics go to stderr (see the onerror handler in main()).
 *
 * Environment: `.env` at the project root is loaded at startup, so the same
 * PST_* settings the web server uses (PST_AI_FALLBACK, PST_OPENROUTER_API_KEY,
 * PST_REDACT, …) work here too. Custom rules and the incident dossier are
 * read from the same local `data/app.db` (WAL mode allows the web server and
 * an MCP process to share it).
 *
 * Run: `npm run mcp`  (or `npx tsx src/mcp/server.ts`)
 */

const TOOLBOX_NAME = "production-support-toolbox";
const TOOLBOX_VERSION = "1.0.0";

const logsSchema = z
  .union([z.string(), z.array(z.string())])
  .describe(
    "The log text to analyse (single string, or up to 5 strings). Maximum 200k chars per log / 600k total.",
  );

/** One MCP text-content block containing the JSON result. */
function textResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/**
 * Stable failure payload, mirroring the HTTP API's error envelope:
 * { ok:false, error:{ code, message, requestId } }. ToolError (validation)
 * keeps its actionable message; anything unexpected becomes a sanitized
 * INTERNAL_ERROR (no SQLite paths / stack traces leak to the agent).
 */
function failureResult(
  error: unknown,
): { content: Array<{ type: "text"; text: string }>; isError: true } {
  const s = sanitizeError(error, "mcp");
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { ok: false, error: { code: s.code, message: s.message, requestId: s.requestId } },
          null,
          2,
        ),
      },
    ],
    isError: true,
  };
}

/**
 * Build the MCP server with all six toolbox tools registered.
 * Exported for tests (in-memory transport); main() starts the stdio server.
 */
export function buildMcpServer(env: NodeJS.ProcessEnv = process.env): McpServer {
  const server = new McpServer({ name: TOOLBOX_NAME, version: TOOLBOX_VERSION });
  registerTools(server, env);
  return server;
}

function registerTools(server: McpServer, env: NodeJS.ProcessEnv): void {

  server.registerTool(
    "analyze",
    {
      title: "Analyze logs",
      description:
        "Deterministic local log analysis: severity, error types, evidence lines, extracted fields (timestamps, levels, components, identifiers, exceptions, sources, HTTP statuses), incident dossier and a quantitative summary. Every text section is returned in BOTH English and Traditional Chinese (…Zh fields; Chinese is hard-converted to Traditional 繁體, never Simplified). The local rule engine runs first; when NO rule matches and PST_AI_FALLBACK=true, an AI fallback (OpenRouter) automatically fills a structured bilingual analysis (analysisSource: \"ai-fallback\", cached per masked-log hash). Sensitive values are masked by default (PST_REDACT=off disables). Scoped custom rules registered via the API apply here too, and past incidents for the same system are recalled.",
      inputSchema: {
        logs: logsSchema,
        system: z
          .string()
          .optional()
          .describe("Optional system hint (custom-rule scoping + past-incident recall)."),
      },
    },
    async ({ logs, system }) => {
      try {
        const result = await runAnalyze({ logs, system }, env);
        return textResult(result);
      } catch (error) {
        return failureResult(error);
      }
    },
  );

  server.registerTool(
    "compare",
    {
      title: "Compare two logs",
      description:
        "Compare a 'before' and an 'after' log: new errors, missing errors, changed HTTP codes, changed exception types / components, error-kind clusters, regression verdict. Run-specific noise (timestamps, ids, ip/url/numbers) is masked before diffing.",
      inputSchema: {
        before: z.string().min(1).describe("The 'before' log text."),
        after: z.string().min(1).describe("The 'after' log text."),
      },
    },
    async ({ before, after }) => {
      try {
        return textResult(runCompare(before, after));
      } catch (error) {
        return failureResult(error);
      }
    },
  );

  server.registerTool(
    "json",
    {
      title: "JSON toolbox",
      description:
        "Format, validate, minify or search JSON. Actions: format (2-space pretty print), validate, minify, search (query matches keys case-insensitively, plus string values when no key matches).",
      inputSchema: {
        input: z.string().min(1).describe("The JSON text."),
        action: z
          .enum(["format", "validate", "minify", "search"])
          .describe("Which JSON operation to run."),
        query: z
          .string()
          .optional()
          .describe("Search key/value — required only for the 'search' action."),
      },
    },
    async ({ input, action, query }) => {
      try {
        return textResult(runJson({ input, action, query }));
      } catch (error) {
        return failureResult(error);
      }
    },
  );

  server.registerTool(
    "sql",
    {
      title: "SQL toolbox",
      description:
        "TEXT ONLY — never connects to or executes against a database. Actions: format (keyword uppercasing + clause line breaks), safety (flags DROP / TRUNCATE / UPDATE|DELETE without WHERE), analyze (statement type, tables, WHERE/JOIN/ORDER BY/GROUP BY, bind parameters).",
      inputSchema: {
        input: z.string().min(1).describe("The SQL text."),
        action: z.enum(["format", "safety", "analyze"]).describe("Which SQL operation to run."),
      },
    },
    async ({ input, action }) => {
      try {
        return textResult(runSql({ input, action }));
      } catch (error) {
        return failureResult(error);
      }
    },
  );

  server.registerTool(
    "timestamp",
    {
      title: "Timestamp converter",
      description:
        "Convert between Unix seconds, Unix milliseconds, ISO 8601, UTC and wall-clock time in any IANA timezone (default Asia/Hong_Kong).",
      inputSchema: {
        input: z
          .string()
          .min(1)
          .describe("e.g. 1787299200, 1787299200000, 2026-08-21 16:00:00 or 2026-08-21T08:00:00Z"),
        timezone: z.string().optional().describe("IANA timezone, default Asia/Hong_Kong."),
      },
    },
    async ({ input, timezone }) => {
      try {
        return textResult(runTimestamp({ input, timezone }));
      } catch (error) {
        return failureResult(error);
      }
    },
  );

  server.registerTool(
    "encoding",
    {
      title: "Base64 / URL encoding",
      description:
        "UTF-8-safe Base64 and URL encode/decode. Actions: base64-encode, base64-decode, url-encode (encodeURIComponent semantics), url-decode, url-encode-path (keeps path characters).",
      inputSchema: {
        input: z.string().min(1).describe("The text to encode or decode."),
        action: z
          .enum(["base64-encode", "base64-decode", "url-encode", "url-decode", "url-encode-path"])
          .describe("Which encoding operation to run."),
      },
    },
    async ({ input, action }) => {
      try {
        return textResult(runEncoding({ input, action }));
      } catch (error) {
        return failureResult(error);
      }
    },
  );
}

/** Load `.env` from the project root (Next.js does this automatically; a plain Node process does not). */
export function loadEnvFile(): void {
  try {
    if (typeof process.loadEnvFile === "function") {
      process.loadEnvFile();
    }
  } catch {
    // .env is optional — the whole toolbox runs fine with defaults.
  }
}

/** Start the stdio MCP server. */
export async function main(): Promise<void> {
  loadEnvFile();
  const server = new McpServer({ name: TOOLBOX_NAME, version: TOOLBOX_VERSION });
  // stderr only — stdout is the MCP protocol channel.
  server.server.onerror = (error) => console.error("[pst-mcp]", error.message);
  // A client that disconnects abruptly (closes the pipe) is normal — exit
  // quietly instead of crashing on an unhandled EPIPE.
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
  });
  registerTools(server, process.env);
  await server.connect(new StdioServerTransport());
}

// Start only when executed directly (not when imported by tests).
const entry = process.argv[1] ?? "";
if (entry.endsWith("/server.ts") || entry.endsWith("\\server.ts")) {
  main().catch((error) => {
    console.error("[pst-mcp] fatal:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}