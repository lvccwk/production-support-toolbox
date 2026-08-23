import { NextRequest, NextResponse } from "next/server";
import { exportAllData, bundleToJson, incidentsToCsv, historyToCsv } from "@/lib/database/export";
import { withApi } from "@/lib/api/route";
import { timedMetric } from "@/lib/api/metrics";
import { ToolError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stamp = () => new Date().toISOString().slice(0, 10);

/**
 * GET /api/export?format=json|csv&kind=incidents|history
 * JSON = full backup bundle (schema-versioned, includes custom rules).
 * CSV = flat, per kind, Excel-friendly (BOM + quoted fields, spreadsheet-safe
 * cells). Always a downloadable attachment. High-privilege (admin scope).
 */
export async function GET(request: NextRequest) {
  return withApi(
    request,
    { route: "/api/export", scope: "admin" },
    async () => {
      const format = request.nextUrl.searchParams.get("format") ?? "json";
      const kind = request.nextUrl.searchParams.get("kind") ?? "incidents";

      const { result: bundle } = timedMetric("export", () => exportAllData());

      if (format === "csv") {
        if (kind !== "incidents" && kind !== "history") {
          throw new ToolError("CSV export requires kind=incidents|history.");
        }
        const text =
          kind === "incidents" ? incidentsToCsv(bundle.incidents) : historyToCsv(bundle.history);
        return new NextResponse(text, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="pst-${kind}-${stamp()}.csv"`,
          },
        });
      }

      if (format !== "json") {
        throw new ToolError("Unknown export format (json|csv).");
      }
      return new NextResponse(bundleToJson(bundle), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="pst-backup-${stamp()}.json"`,
        },
      });
    },
  );
}