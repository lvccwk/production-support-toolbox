import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildMcpServer } from "./server";
import { closeDb, initDb } from "@/lib/database/db";

/**
 * MCP surface tests — the server is exercised end-to-end over the MCP
 * protocol (in-memory transport + real Client), exactly as Claude Code /
 * Cursor / opencode would talk to it. The DB is isolated per test so the
 * real data/app.db is never touched.
 */

const TOOL_NAMES = ["analyze", "compare", "encoding", "json", "sql", "timestamp"];

describe("MCP server", () => {
  let tempDir: string;
  let seq = 0;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pst-mcp-"));
  });

  beforeEach(() => {
    seq += 1;
    initDb(path.join(tempDir, `mcp-${seq}.db`));
  });

  afterAll(() => {
    closeDb();
  });

  async function connectClient(): Promise<{ client: Client; close: () => Promise<void> }> {
    const server: McpServer = buildMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "pst-mcp-test", version: "1.0.0" });
    await client.connect(clientTransport);
    return {
      client,
      close: async () => {
        await client.close();
        await server.close();
      },
    };
  }

  it("advertises exactly the six toolbox tools via tools/list", async () => {
    const { client, close } = await connectClient();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual(TOOL_NAMES);
      // Every tool ships a description agents can read before calling.
      for (const tool of tools) {
        expect(tool.description?.length).toBeGreaterThan(20);
      }
    } finally {
      await close();
    }
  });

  it("runs json/format through the shared runner", async () => {
    const { client, close } = await connectClient();
    try {
      const res = await client.callTool({
        name: "json",
        arguments: { input: '{"b":1,"a":2}', action: "format" },
      });
      const content = res.content as Array<{ type: string; text: string }>;
      expect(JSON.parse(content[0].text).output).toContain("\n");
    } finally {
      await close();
    }
  });

  it("runs analyze end-to-end (rule engine + bilingual output)", async () => {
    const { client, close } = await connectClient();
    try {
      const res = await client.callTool({
        name: "analyze",
        arguments: {
          logs: "2026-08-21 10:15:22 ERROR PaymentBatch java.lang.NullPointerException at PaymentService.java:125",
          system: "PaymentBatch",
        },
      });
      const content = res.content as Array<{ type: string; text: string }>;
      const result = JSON.parse(content[0].text) as {
        analysisSource: string;
        errorTypes: string[];
        rootCausesZh?: string[];
        extracted: { exceptions: string[]; sources: Array<{ file: string }> };
      };
      expect(result.analysisSource).toBe("rules");
      expect(result.errorTypes).toContain("NullPointerException");
      expect(result.rootCausesZh?.length).toBeGreaterThan(0);
      expect(result.extracted.exceptions).toContain("NullPointerException");
      expect(result.extracted.sources).toEqual(
        expect.arrayContaining([expect.objectContaining({ file: "PaymentService.java" })]),
      );
    } finally {
      await close();
    }
  });

  it("reports validation failures as structured isError results, not crashes", async () => {
    const { client, close } = await connectClient();
    try {
      // Schema-valid argument that fails DOMAIN validation in the runner
      // (unsupported timezone) — must surface as our JSON error envelope.
      const res = await client.callTool({
        name: "timestamp",
        arguments: { input: "2026-08-21", timezone: "Moon/Mare" },
      });
      expect(res.isError).toBe(true);
      const content = res.content as Array<{ type: string; text: string }>;
      const error = JSON.parse(content[0].text) as { ok: boolean; error: { code: string } };
      expect(error.ok).toBe(false);
      expect(error.error.code).toBe("VALIDATION_ERROR");
    } finally {
      await close();
    }
  });

  it("runs every remaining stateless tool", async () => {
    const { client, close } = await connectClient();
    try {
      const compare = await client.callTool({
        name: "compare",
        arguments: { before: "HTTP 200", after: "HTTP 500" },
      });
      const compareContent = compare.content as Array<{ type: string; text: string }>;
      expect(JSON.parse(compareContent[0].text).regression).toBe(true);

      for (const [name, args] of [
        ["sql", { input: "DELETE FROM customer;", action: "safety" }],
        ["timestamp", { input: "2026-08-21 16:00:00" }],
        ["encoding", { input: "hello world", action: "base64-encode" }],
      ] as const) {
        const res = await client.callTool({ name, arguments: args });
        expect(res.isError).toBeFalsy();
        const content = res.content as Array<{ type: string; text: string }>;
        expect(content[0]).toMatchObject({ type: "text" });
      }
    } finally {
      await close();
    }
  });
});