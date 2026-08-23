import { NextRequest } from "next/server";
import { importBundleJson } from "@/lib/database/export";
import { withApi } from "@/lib/api/route";
import { timedMetricAsync } from "@/lib/api/metrics";
import { ToolError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Max size of the `data` string holding the backup bundle JSON. */
export const MAX_IMPORT_DATA_CHARS = 2_000_000;

/**
 * POST /api/import — restore a backup JSON bundle (all-or-nothing;
 * duplicates are skipped). Body: { data: string } (bundle JSON).
 * High-privilege (admin scope).
 */
export async function POST(request: NextRequest) {
  return withApi(
    request,
    { route: "/api/import", scope: "admin" },
    async () => {
      const raw = (await request.json()) as { data?: unknown };
      const data = raw.data;
      if (typeof data !== "string" || !data.trim()) {
        throw new ToolError("Please provide backup JSON in 'data'.");
      }
      if (data.length > MAX_IMPORT_DATA_CHARS) {
        throw new ToolError(`Backup JSON too large (max ${MAX_IMPORT_DATA_CHARS} chars).`);
      }
      const { result } = await timedMetricAsync("import", async () => importBundleJson(data));
      return result;
    },
  );
}