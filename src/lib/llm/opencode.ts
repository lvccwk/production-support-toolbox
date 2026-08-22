import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type {
  LlmAnalysisRequest,
  LlmProvider,
  LlmProviderResult,
} from "./provider";
import { ToolError } from "@/lib/errors";

/**
 * OpenCode CLI adapter (Phase 3, path A: subprocess).
 *
 * Runs `opencode run "<prompt>"` as a child process and parses the model's
 * final message as JSON. Safety guards:
 *   - a sandbox working directory is used as cwd (never the project root),
 *   - a hard timeout SIGKILLs runaway agents,
 *   - stdout is capped and the process is killed past the cap,
 *   - the prompt hard-limits the agent to analysis-only (see prompts.ts).
 *
 * CLI differences between OpenCode versions are isolated in this file; the
 * actual flags can be checked with `opencode run --help`.
 */

export interface OpenCodeOptions {
  /** Executable; default "opencode" (or PST_OPNCODE_BIN). */
  bin?: string;
  /** Optional model override passed as `--model <model>` (version-dependent). */
  model?: string | null;
  /** Hard timeout in ms. Default 120s (PST_OPNCODE_TIMEOUT_S). */
  timeoutMs?: number;
  /** Max stdout bytes before the process is killed. Default 64 KiB. */
  maxOutputBytes?: number;
  /** Sandbox working directory (default ./data/opencode-workdir). */
  workDir?: string;
  /** Extra environment variables merged over the current process env. */
  env?: Record<string, string>;
  /** Extra CLI arguments appended after `run <prompt>`. */
  extraArgs?: string[];
}

/** Resolve runtime options from environment variables (server-side). */
export function resolveOpenCodeOptions(
  env: NodeJS.ProcessEnv = process.env,
): OpenCodeOptions {
  const timeoutSeconds = Number(env.PST_OPNCODE_TIMEOUT_S ?? 120);
  return {
    bin: env.PST_OPNCODE_BIN || "opencode",
    model: env.PST_OPNCODE_MODEL || null,
    timeoutMs: Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
      ? timeoutSeconds * 1000
      : 120_000,
    workDir: env.PST_OPNCODE_WORKDIR || path.join("data", "opencode-workdir"),
    env: {},
  };
}

/**
 * Extract a JSON object from model output: plain JSON first, then a fenced
 * ```json block, then the largest balanced {...} region. Returns null when
 * nothing parses.
 */
export function extractJsonBlock(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  const isObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isObject(parsed)) return parsed;
  } catch {
    /* fall through */
  }

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      const parsed: unknown = JSON.parse(fence[1].trim());
      if (isObject(parsed)) return parsed;
    } catch {
      /* fall through */
    }
  }

  const open = trimmed.indexOf("{");
  const close = trimmed.lastIndexOf("}");
  if (open >= 0 && close > open) {
    try {
      const parsed: unknown = JSON.parse(trimmed.slice(open, close + 1));
      if (isObject(parsed)) return parsed;
    } catch {
      /* fall through */
    }
  }
  return null;
}

function tail(text: string, max = 300): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `…${trimmed.slice(-max)}` : trimmed;
}

export class OpenCodeProvider implements LlmProvider {
  readonly id = "opencode";
  private options: OpenCodeOptions;

  constructor(options: OpenCodeOptions = {}) {
    this.options = { ...resolveOpenCodeOptions(), ...options };
  }

  async analyze(request: LlmAnalysisRequest): Promise<LlmProviderResult> {
    const { bin, model, timeoutMs, maxOutputBytes, workDir, env } = this.options;
    const hardTimeout = request.timeoutMs ?? timeoutMs ?? 120_000;
    const outputCap = maxOutputBytes ?? 65_536;
    const start = Date.now();

    // Sandbox: never run the agent with the project root as cwd.
    const cwd = path.resolve(workDir ?? "data/opencode-workdir");
    mkdirSync(cwd, { recursive: true });

    const args = ["run"];
    // Model override is version-dependent; the stub tests tolerate it.
    if (model) args.push("--model", model);
    args.push(request.user);
    if (this.options.extraArgs) args.push(...this.options.extraArgs);

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...env,
      ...request.env,
    };

    return await new Promise<LlmProviderResult>((resolve, reject) => {
      let child;
      try {
        child = spawn(bin ?? "opencode", args, {
          cwd,
          env: childEnv,
          shell: false,
        });
      } catch {
        reject(new ToolError(`Failed to start '${bin ?? "opencode"}'.`));
        return;
      }

      let settled = false;
      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        fn();
      };

      let stdout = "";
      let stderr = "";
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        child.kill("SIGKILL");
      }, hardTimeout);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        if (stdout.length > outputCap) {
          killed = true;
          child.kill("SIGKILL");
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        settle(() =>
          reject(
            new ToolError(
              `Failed to run '${bin ?? "opencode"}': ${err.message}`,
            ),
          ),
        );
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        settle(() => {
          if (killed || code === null) {
            reject(
              new ToolError(
                `'${bin ?? "opencode"}' ${killed ? "timed out" : "ended unexpectedly"} after ${hardTimeout}ms.`,
              ),
            );
            return;
          }
          if (code !== 0) {
            reject(
              new ToolError(
                `'${bin ?? "opencode"}' exited with code ${code}: ${tail(stderr)}`,
              ),
            );
            return;
          }
          const json = extractJsonBlock(stdout);
          if (!json) {
            reject(
              new ToolError(
                `'${bin ?? "opencode"}' returned no valid JSON. Output: ${tail(stdout)}`,
              ),
            );
            return;
          }
          resolve({
            provider: "opencode",
            model: model ?? null,
            durationMs: Date.now() - start,
            json,
          });
        });
      });
    });
  }
}