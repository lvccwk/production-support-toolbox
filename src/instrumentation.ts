/**
 * Server bootstrap hook (Next.js instrumentation). Starts the in-process
 * alert webhook worker: pending jobs are drained on an interval with retry +
 * exponential backoff, so Save Analysis never blocks on webhook delivery.
 * Jobs persist in SQLite, so anything queued while the server was down is
 * sent on the next start.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // No timers during `next build`.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startAlertWorker } = await import("@/lib/database/alerts");
  startAlertWorker();
}