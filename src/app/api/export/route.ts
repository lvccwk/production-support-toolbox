import { NextRequest, NextResponse } from "next/server";
import { exportAllData, bundleToJson, incidentsToCsv, historyToCsv } from "@/lib/database/export";
import { ToolError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown, status = 400): NextResponse {
  const message =
    error instanceof ToolError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Unexpected error.";
  return NextResponse.json({ ok: false, error: message }, { status });
}

const stamp = () => new Date().toISOString().slice(0, 10);

/**
 * GET /api/export?format=json|csv&kind=incidents|history
 * JSON = full backup bundle (schema-versioned). CSV = flat, per kind,
 * Excel-friendly (BOM + quoted fields). Always a downloadable attachment.
 */
export async function GET(request: NextRequest) {
  try {
    const format = request.nextUrl.searchParams.get("format") ?? "json";
    const kind = request.nextUrl.searchParams.get("kind") ?? "incidents";

    const bundle = exportAllData();

    if (format === "csv") {
      if (kind !== "incidents" && kind !== "history") {
        throw new ToolError("CSV export requires kind=incidents|history.");
      }
      const text = kind === "incidents" ? incidentsToCsv(bundle.incidents) : historyToCsv(bundle.history);
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
  } catch (error) {
    return errorResponse(error, 400);
  }
}