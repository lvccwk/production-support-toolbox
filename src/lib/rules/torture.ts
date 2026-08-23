import { Worker } from "node:worker_threads";

/**
 * Empirical ReDoS backstop (Engineering Review §4).
 *
 * Static screening (regexSafety.ts) rejects the *known* catastrophic shapes,
 * but a pattern can still be pathologically slow on some inputs without
 * matching a simple shape. So BEFORE a rule is stored, every pattern runs
 * against a set of adversarial inputs inside a worker thread with a HARD
 * time budget: if the whole batch does not finish in time the worker is
 * terminated and the pattern is rejected as unsafe. A pattern that survives
 * is therefore proven to complete quickly on inputs designed to trigger
 * backtracking — it cannot hang the analysis request later.
 *
 * The budget starts only after the worker signals READY, so worker spun-up
 * latency is never counted against legitimate patterns; only actual pattern
 * execution time is.
 *
 * The worker runs as plain JavaScript via `eval: true` so this module works
 * identically under Next.js (Turbopack) and Vitest without file-resolution
 * gymnastics.
 */

/** Default hard time budget for one registration/import batch of patterns. */
export const TORTURE_BUDGET_MS = 300;

/**
 * Adversarial inputs: long runs of a single character, repeating pairs,
 * near-miss tails (all matchable prefixes then a failing char) — the classic
 * triggers for exponential backtracking on `(a+)+`-style patterns.
 *
 * Sizes are deliberately MODERATE (thousands of chars, not hundreds of
 * thousands): a true catastrophic pattern is exponential, so even ~10k chars
 * is effectively unbounded work, while LEGITIMATE patterns with `.*` tails
 * can be quadratic in V8 on same-prefix runs (measured ~29ms at 10k chars)
 * and must NOT be rejected as false positives. At 200k chars such safe
 * patterns take >10s, which would break the budget for every registration.
 */
export const TORTURE_INPUTS: readonly string[] = [
  "a".repeat(12_000),
  "a".repeat(11_999) + "b",
  "ab".repeat(6_000),
  "abc".repeat(4_000),
  "aaaaX".repeat(2_400),
  "a b ".repeat(3_000),
  "",
];

const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
try {
  parentPort.postMessage({ type: "ready" });
  const start = Date.now();
  for (const pattern of workerData.patterns) {
    const re = new RegExp(pattern);
    for (const input of workerData.inputs) {
      re.test(input);
    }
  }
  parentPort.postMessage({ type: "result", ok: true, elapsedMs: Date.now() - start });
} catch (error) {
  parentPort.postMessage({ type: "result", ok: false, error: String((error && error.message) || error) });
}
`;

export interface TortureResult {
  ok: boolean;
  elapsedMs?: number;
  error?: string;
  timedOut?: boolean;
}

export interface TortureOptions {
  budgetMs?: number;
  inputs?: readonly string[];
}

/**
 * Run every pattern against every adversarial input inside a worker with a
 * hard budget (measured from worker readiness). Resolves when the worker
 * finishes, when it errors, or when the budget expires (worker terminated —
 * the pattern is too slow). Never rejects.
 */
export function torturePatterns(
  patterns: readonly string[],
  opts?: TortureOptions,
): Promise<TortureResult> {
  const budgetMs = opts?.budgetMs ?? TORTURE_BUDGET_MS;
  const inputs = opts?.inputs ?? TORTURE_INPUTS;
  return new Promise((resolve) => {
    let settled = false;
    let worker: Worker | null = null;
    let timer: NodeJS.Timeout | null = null;

    const finish = (result: TortureResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    try {
      worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: { patterns: [...patterns], inputs: [...inputs] },
      });
      worker.on("message", (message: { type: string; ok?: boolean; elapsedMs?: number; error?: string }) => {
        if (message.type === "ready") {
          timer = setTimeout(() => {
            if (settled) return;
            if (worker) {
              void worker.terminate().catch(() => undefined);
            }
            finish({
              ok: false,
              timedOut: true,
              error: `Pattern execution exceeded the ${budgetMs}ms safety budget.`,
            });
          }, budgetMs);
          return;
        }
        finish(
          message.ok
            ? { ok: true, elapsedMs: message.elapsedMs }
            : { ok: false, error: message.error ?? "Pattern execution failed." },
        );
      });
      worker.on("error", (error) => {
        finish({ ok: false, error: `Pattern worker error: ${error.message}` });
      });
      worker.on("exit", (code) => {
        if (code === 0) return; // message handler already resolved
        finish({ ok: false, error: `Pattern worker exited with code ${code}.` });
      });
    } catch (error) {
      finish({
        ok: false,
        error: `Could not start pattern worker: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });
}