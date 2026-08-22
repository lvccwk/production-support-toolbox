import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpenCodeProvider, extractJsonBlock } from "./opencode";
import type { LlmAnalysisRequest } from "./provider";

/**
 * The real `opencode` CLI is a runtime requirement, not a test dependency:
 * these tests drive the adapter with a stub executable that mimics the CLI
 * contract (exit code 0 + JSON on stdout, or the failure modes below).
 */

let tempDir: string;
let stubBin: string;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pst-opencode-"));
  stubBin = path.join(tempDir, "stub-opencode");
  fs.writeFileSync(
    stubBin,
    `#!/usr/bin/env node
const sleep = Number(process.env.STUB_SLEEP_MS || 0);
const big = process.env.STUB_BIG === "1";
if (sleep > 0) {
  const end = Date.now() + sleep;
  while (Date.now() < end) { /* busy wait */ }
}
if (big) {
  process.stdout.write("x".repeat(200_000));
  process.exit(0);
}
const exitCode = Number(process.env.STUB_EXIT || 0);
if (exitCode !== 0) {
  process.stderr.write(process.env.STUB_STDERR || "");
  process.exit(exitCode);
}
const json = process.env.STUB_JSON ||
  JSON.stringify({ severity: "High", rootCause: "stub cause", evidenceLines: [2] });
process.stdout.write(json);
process.exit(0);
`,
  );
  fs.chmodSync(stubBin, 0o755);
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function request(overrides: Partial<LlmAnalysisRequest> = {}): LlmAnalysisRequest {
  return {
    system: "You are a support engineer.",
    user: "Analyse this.",
    ...overrides,
  };
}

function provider(options: Record<string, unknown> = {}): OpenCodeProvider {
  return new OpenCodeProvider({ bin: stubBin, workDir: tempDir, ...options });
}

describe("extractJsonBlock", () => {
  it("parses plain JSON output", () => {
    expect(extractJsonBlock('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses a fenced ```json block", () => {
    expect(
      extractJsonBlock('Let me think...\n```json\n{"a":2}\n```\nDone.'),
    ).toEqual({ a: 2 });
  });

  it("parses the largest balanced JSON region with surrounding prose", () => {
    expect(extractJsonBlock('Here: {"a":3} hope that helps')).toEqual({ a: 3 });
  });

  it("returns null for non-JSON output", () => {
    expect(extractJsonBlock("no json here")).toBeNull();
    expect(extractJsonBlock("")).toBeNull();
  });
});

describe("OpenCodeProvider", () => {
  it("parses the stub's JSON result into LlmProviderResult", async () => {
    const result = await provider().analyze(request());
    expect(result.provider).toBe("opencode");
    expect(result.json).toEqual({
      severity: "High",
      rootCause: "stub cause",
      evidenceLines: [2],
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("merges request-level env vars", async () => {
    const result = await provider().analyze(
      request({ env: { STUB_JSON: '{"custom":true}' } }),
    );
    expect(result.json).toEqual({ custom: true });
  });

  it("rejects when output is not JSON", async () => {
    await expect(
      provider().analyze(request({ env: { STUB_JSON: "I am not json" } })),
    ).rejects.toThrowError(/no valid JSON/);
  });

  it("rejects with stderr tail on non-zero exit", async () => {
    await expect(
      provider().analyze(request({ env: { STUB_EXIT: "3", STUB_STDERR: "boom detail" } })),
    ).rejects.toThrowError(/exited with code 3: boom detail/);
  });

  it("kills runaway agents on timeout", async () => {
    await expect(
      provider({ timeoutMs: 300 }).analyze(
        request({ env: { STUB_SLEEP_MS: "5000" } }),
      ),
    ).rejects.toThrowError(/timed out/);
  });

  it("kills the process when stdout exceeds the cap", async () => {
    await expect(
      provider({ maxOutputBytes: 1024 }).analyze(
        request({ env: { STUB_BIG: "1" } }),
      ),
    ).rejects.toThrowError(/timed out|output/);
  });

  it("rejects cleanly when the binary does not exist", async () => {
    await expect(
      new OpenCodeProvider({ bin: path.join(tempDir, "missing"), workDir: tempDir }).analyze(
        request(),
      ),
    ).rejects.toThrowError(/Failed to run/);
  });
});